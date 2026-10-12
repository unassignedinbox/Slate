/* ============================================================================
   Textures — every surface in Slate is synthesised at boot.

   No binary assets ship with the repo: albedo + normal maps are baked from
   analytic noise / vector drawings into canvases, then cached. The symbol
   atlas is a 4x4 grid of road markings drawn as vector paths.
   ========================================================================== */

import * as THREE from 'three';
import { SURFACES } from '../model/Presets.js';
import { NoiseField, clamp, lerp, smoothstep } from '../core/mathx.js';

const cache = new Map();

/* --------------------------------------------------------------- helpers -- */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function hexToRGB(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/** Height buffer -> tangent-space normal map. */
function heightToNormal(height, w, h, strength = 1.0) {
  const data = new Uint8ClampedArray(w * h * 4);
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const cv = makeCanvas(w, h);
  cv.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  return cv;
}

function canvasToTexture(cv, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ---------------------------------------------------------------- noise --- */

let noiseA = null, noiseB = null, noiseC = null;
function noises() {
  if (!noiseA) {
    noiseA = new NoiseField(1337, 256);
    noiseB = new NoiseField(7331, 256);
    noiseC = new NoiseField(4242, 256);
  }
  return [noiseA, noiseB, noiseC];
}

/* ------------------------------------------------------------- surfaces --- */

/**
 * Bake albedo + normal for one surface definition.
 * @returns {{map:THREE.Texture, normalMap:THREE.Texture, rough:number}}
 */
export function bakeSurface(key) {
  if (cache.has(key)) return cache.get(key);
  const def = SURFACES[key] || SURFACES.asphalt;
  const size = ['asphalt', 'concrete', 'paver', 'sett', 'cobble', 'grass', 'ballast'].includes(key) ? 512 : 256;
  const [na, nb, nc] = noises();

  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const D = img.data;
  const height = new Float32Array(size * size);
  const base = hexToRGB(def.base);
  const kind = def.kind;

  // per-surface tile frequency in texels
  const F = 4 / (def.tile || 2);   // features per metre -> per texture
  const pxPerM = size / (def.tile || 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * (def.tile || 2);
      const v = (y / size) * (def.tile || 2);
      let r = base.r, g = base.g, b = base.b, hh = 0;

      switch (kind) {
        case 'asphalt': {
          const fine = na.fbm(u * 26, v * 26, 4, 2.1, 0.55);
          const grain = nb.sample(u * 95, v * 95);
          const blotch = nc.fbm(u * 2.2, v * 2.2, 3, 2, 0.5);
          hh = fine * 0.45 + grain * 0.55;
          const shade = 0.82 + fine * 0.16 + blotch * 0.14 + grain * 0.10;
          r *= shade; g *= shade; b *= shade;
          // aggregate chips
          const chip = nb.sample(u * 46 + 13, v * 46 + 7);
          if (chip > 0.72) { const s2 = 1.10; r *= s2; g *= s2; b *= s2; hh += 0.18; }
          break;
        }
        case 'slab': {
          const sw = def.slab ? def.slab[0] : 1, sh = def.slab ? def.slab[1] : 1;
          const gx = Math.floor(u / sw), gy = Math.floor(v / sh);
          const fx = (u / sw) % 1, fy = (v / sh) % 1;
          const joint = 0.035;
          const inJ = fx < joint / sw * 1 || fx > 1 - joint / sw * 1 || fy < joint / sh * 1 || fy > 1 - joint / sh * 1;
          const idv = na.sample(gx * 7.3 + 0.5, gy * 5.1 + 0.5);
          const speck = nb.fbm(u * 30, v * 30, 3, 2, 0.5);
          const shade = 0.90 + idv * 0.09 + speck * 0.07;
          if (inJ) { const s2 = 0.74; r *= s2; g *= s2; b *= s2; hh = -0.45; }
          else { r *= shade; g *= shade; b *= shade; hh = speck * 0.25; }
          break;
        }
        case 'paver': {
          const pw = def.paver ? def.paver[0] : 0.2, ph = def.paver ? def.paver[1] : 0.1;
          const row = Math.floor(v / ph);
          const stagger = (row % 2) * 0.5;
          const gx = Math.floor(u / pw + stagger);
          const fx = (u / pw + stagger) % 1, fy = (v / ph) % 1;
          const joint = 0.06;
          const inJ = fx < joint || fx > 1 - joint || fy < joint || fy > 1 - joint;
          const idv = na.sample(gx * 3.7 + row * 1.9, row * 2.3 + 0.5);
          const grain = nb.fbm(u * 60, v * 60, 3, 2, 0.5);
          if (inJ) { const s2 = 0.62; r *= s2; g *= s2; b *= s2; hh = -0.6; }
          else {
            const shade = 0.88 + idv * 0.16 + grain * 0.09;
            r *= shade; g *= shade; b *= shade; hh = grain * 0.22 + idv * 0.1;
          }
          break;
        }
        case 'cobble': {
          const cw = 0.16;
          const row = Math.floor(v / cw);
          const stagger = (row % 2) * 0.5;
          const gx = Math.floor(u / cw + stagger);
          const fx = (u / cw + stagger) % 1, fy = (v / cw) % 1;
          const dx = (fx - 0.5), dy = (fy - 0.5);
          const rr = Math.hypot(dx, dy);
          const idv = na.sample(gx * 5.1 + 0.5, row * 3.3 + 0.5);
          const dome = clamp(1 - rr / 0.42, 0, 1);
          if (rr > 0.44) { const s2 = 0.55; r *= s2; g *= s2; b *= s2; hh = -0.8; }
          else {
            const shade = 0.86 + idv * 0.20 + dome * 0.16;
            r *= shade; g *= shade; b *= shade; hh = dome * 0.9;
          }
          break;
        }
        case 'gravel': {
          const g1 = na.fbm(u * 34, v * 34, 4, 2.2, 0.5);
          const g2 = nb.sample(u * 70, v * 70);
          hh = g1 * 0.7 + g2 * 0.5;
          const shade = 0.80 + g1 * 0.30 + g2 * 0.20;
          r *= shade; g *= shade; b *= shade;
          break;
        }
        case 'grass': {
          const g1 = na.fbm(u * 18, v * 18, 4, 2, 0.55);
          const g2 = nb.sample(u * 60, v * 60);
          hh = g1 * 0.5 + g2 * 0.5;
          const shade = 0.82 + g1 * 0.36 + g2 * 0.14;
          r *= shade; g *= shade * 1.04; b *= shade * 0.92;
          break;
        }
        case 'wood': {
          const rings = Math.sin((u * 9 + na.fbm(u * 4, v * 4, 3, 2, 0.5) * 4) * Math.PI * 2);
          const grain = nb.fbm(u * 90, v * 8, 3, 2, 0.5);
          hh = rings * 0.15 + grain * 0.2;
          const shade = 0.86 + rings * 0.10 + grain * 0.16;
          r *= shade; g *= shade; b *= shade;
          break;
        }
        case 'metal': {
          const g1 = na.fbm(u * 40, v * 8, 3, 2, 0.5);
          hh = g1 * 0.12;
          const shade = 0.94 + g1 * 0.12;
          r *= shade; g *= shade; b *= shade;
          break;
        }
        case 'concrete': {
          const g1 = na.fbm(u * 20, v * 20, 3, 2, 0.5);
          const streak = nb.fbm(u * 3, v * 60, 3, 2, 0.5);
          hh = g1 * 0.2 + streak * 0.12;
          const shade = 0.93 + g1 * 0.10 + streak * 0.07;
          r *= shade; g *= shade; b *= shade;
          break;
        }
        case 'chequer': {
          const n = 8;
          const c = (Math.floor(u * n) + Math.floor(v * n)) % 2;
          const s2 = c ? 1.0 : 0.06;
          r = lerp(r, 20, 1 - s2); g = lerp(g, 20, 1 - s2); b = lerp(b, 22, 1 - s2);
          hh = c ? 0 : -0.3;
          break;
        }
        case 'paint': {
          const wear = na.fbm(u * 14, v * 14, 4, 2, 0.5);
          const chips = nb.sample(u * 40, v * 40);
          const tint = 0.92 + wear * 0.12;
          r *= tint; g *= tint; b *= tint;
          if (chips > 0.78) { const s2 = 0.86; r *= s2; g *= s2; b *= s2; }
          hh = wear * 0.1;
          break;
        }
        default: {
          const g1 = na.fbm(u * 20, v * 20, 3, 2, 0.5);
          hh = g1 * 0.3;
          const shade = 0.9 + g1 * 0.18;
          r *= shade; g *= shade; b *= shade;
        }
      }

      const i = (y * size + x) * 4;
      D[i] = clamp(r, 0, 255);
      D[i + 1] = clamp(g, 0, 255);
      D[i + 2] = clamp(b, 0, 255);
      D[i + 3] = 255;
      height[y * size + x] = hh * (def.bump ?? 1);
    }
  }
  ctx.putImageData(img, 0, 0);

  const nrmCv = heightToNormal(height, size, size, 2.4);
  const map = canvasToTexture(cv, { srgb: true });
  const normalMap = canvasToTexture(nrmCv, { srgb: false });
  const out = { map, normalMap, rough: def.rough, metal: def.metal ?? 0 };
  cache.set(key, out);
  return out;
}

/* ---------------------------------------------------------- symbol atlas -- */

export function buildSymbolAtlas() {
  if (cache.has('__atlas')) return cache.get('__atlas');
  const S = 128, G = 4;
  const cv = makeCanvas(S * G, S * G);
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S * G, S * G);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineCap = 'butt';
  g.lineJoin = 'miter';

  const cell = (i, fn) => {
    const cx = (i % G) * S, cy = Math.floor(i / G) * S;
    g.save();
    g.translate(cx, cy);
    g.beginPath();
    g.rect(0, 0, S, S);
    g.clip();
    fn(g, S);
    g.restore();
  };

  // Row 0: arrows
  const arrow = (dirs) => (gg, S) => {
    const cx = S / 2, cy = S / 2;
    gg.translate(cx, cy);
    gg.scale(S / 100, S / 100);
    gg.lineWidth = 11;
    gg.strokeStyle = '#fff';
    gg.fillStyle = '#fff';
    // shaft
    gg.beginPath();
    gg.moveTo(0, 34); gg.lineTo(0, -6);
    gg.stroke();
    for (const a of dirs) {
      gg.save();
      gg.rotate(a);
      gg.beginPath();
      gg.moveTo(0, -34);
      gg.lineTo(-15, -10);
      gg.lineTo(-5.5, -10);
      gg.lineTo(-5.5, 6);
      gg.lineTo(5.5, 6);
      gg.lineTo(5.5, -10);
      gg.lineTo(15, -10);
      gg.closePath();
      gg.fill();
      gg.restore();
    }
  };

  cell(0, arrow([0]));
  cell(1, arrow([Math.PI / 2]));
  cell(2, arrow([-Math.PI / 2]));
  cell(3, arrow([Math.PI / 2, 0]));
  cell(4, arrow([-Math.PI / 2, 0]));
  cell(5, arrow([Math.PI / 2, -Math.PI / 2]));
  cell(6, (gg, S) => {
    gg.translate(S / 2, S / 2); gg.scale(S / 100, S / 100);
    gg.lineWidth = 11; gg.strokeStyle = '#fff'; gg.fillStyle = '#fff';
    gg.beginPath();
    gg.moveTo(-18, 30);
    gg.lineTo(-18, -2);
    gg.arc(0, -2, 18, Math.PI, 0, false);
    gg.lineTo(18, 26);
    gg.stroke();
    gg.beginPath();
    gg.moveTo(18, 34); gg.lineTo(6, 16); gg.lineTo(30, 16);
    gg.closePath(); gg.fill();
  });

  // Row 1
  cell(7, (gg, S) => { // cycle symbol
    gg.translate(S / 2, S / 2); gg.scale(S / 100, S / 100);
    gg.lineWidth = 9; gg.strokeStyle = '#fff'; gg.fillStyle = '#fff';
    for (const cx of [-13, 13]) {
      gg.beginPath(); gg.arc(cx, 12, 13, 0, Math.PI * 2); gg.stroke();
    }
    gg.beginPath();
    gg.moveTo(-13, 12); gg.lineTo(-2, -18); gg.lineTo(13, -18);
    gg.lineTo(21, -4); gg.lineTo(6, 12); gg.lineTo(-13, 12);
    gg.stroke();
    gg.beginPath();
    gg.moveTo(-2, -18); gg.lineTo(-12, -30);
    gg.lineTo(4, -30);
    gg.stroke();
  });
  cell(8, (gg, S) => { // BUS legend
    gg.fillStyle = '#fff';
    gg.font = `700 ${S * 0.42}px Inter, Helvetica, Arial, sans-serif`;
    gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.save(); gg.translate(S / 2, S / 2); gg.scale(1, 2.0); gg.fillText('BUS', 0, 0); gg.restore();
  });
  cell(9, (gg, S) => {
    gg.fillStyle = '#fff';
    gg.font = `700 ${S * 0.32}px Inter, Helvetica, Arial, sans-serif`;
    gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.save(); gg.translate(S / 2, S / 2); gg.scale(1, 2.0); gg.fillText('TAXI', 0, 0); gg.restore();
  });
  cell(10, (gg, S) => { // bus-lane diamond
    gg.translate(S / 2, S / 2); gg.scale(S / 100, S / 100);
    gg.fillStyle = '#fff';
    gg.beginPath();
    gg.moveTo(0, -40); gg.lineTo(16, 0); gg.lineTo(0, 40); gg.lineTo(-16, 0);
    gg.closePath(); gg.fill();
  });
  cell(11, (gg, S) => { // pedestrian
    gg.translate(S / 2, S / 2); gg.scale(S / 100, S / 100);
    gg.fillStyle = '#fff';
    gg.beginPath(); gg.arc(0, -26, 9, 0, Math.PI * 2); gg.fill();
    gg.lineWidth = 10; gg.strokeStyle = '#fff'; gg.lineCap = 'round';
    gg.beginPath();
    gg.moveTo(0, -14); gg.lineTo(0, 12);
    gg.moveTo(0, 0); gg.lineTo(-13, 22);
    gg.moveTo(0, 0); gg.lineTo(13, 22);
    gg.moveTo(-14, -8); gg.lineTo(14, -8);
    gg.stroke();
  });
  cell(12, (gg, S) => { // chevron
    gg.translate(S / 2, S / 2); gg.scale(S / 100, S / 100);
    gg.strokeStyle = '#fff'; gg.lineWidth = 13; gg.lineCap = 'square';
    gg.beginPath();
    gg.moveTo(-32, 26); gg.lineTo(0, -20); gg.lineTo(32, 26);
    gg.stroke();
  });
  cell(13, (gg, S) => { // give-way triangle
    gg.translate(S / 2, S / 2); gg.scale(S / 100, S / 100);
    gg.strokeStyle = '#fff'; gg.lineWidth = 10;
    gg.beginPath();
    gg.moveTo(0, -36); gg.lineTo(34, 30); gg.lineTo(-34, 30);
    gg.closePath(); gg.stroke();
  });
  cell(14, (gg, S) => { // St Andrew's cross (level crossing)
    gg.translate(S / 2, S / 2); gg.scale(S / 100, S / 100);
    gg.strokeStyle = '#fff'; gg.lineWidth = 12; gg.lineCap = 'round';
    gg.beginPath();
    gg.moveTo(-26, -26); gg.lineTo(26, 26);
    gg.moveTo(26, -26); gg.lineTo(-26, 26);
    gg.stroke();
  });
  cell(15, (gg, S) => {
    gg.fillStyle = '#fff';
    gg.font = `700 ${S * 0.28}px Inter, Helvetica, Arial, sans-serif`;
    gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.save(); gg.translate(S / 2, S / 2); gg.scale(1, 2.0); gg.fillText('SLOW', 0, 0); gg.restore();
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set('__atlas', tex);
  return tex;
}

/* ------------------------------------------------------------ environment -- */

/** Small equirectangular sky gradient -> PMREM environment map. */
export function buildEnvironment(renderer) {
  if (cache.has('__env')) return cache.get('__env');
  const w = 128, h = 64;
  const cv = makeCanvas(w, h);
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0.0, '#7fa8cf');
  grd.addColorStop(0.42, '#c8d6e0');
  grd.addColorStop(0.52, '#e8e2d4');
  grd.addColorStop(0.62, '#6b6a5e');
  grd.addColorStop(1.0, '#33322c');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  // a soft sun blob so specular highlights have something to catch
  const sg = g.createRadialGradient(w * 0.68, h * 0.22, 0, w * 0.68, h * 0.22, h * 0.34);
  sg.addColorStop(0, 'rgba(255,250,235,1)');
  sg.addColorStop(0.25, 'rgba(255,244,220,0.55)');
  sg.addColorStop(1, 'rgba(255,244,220,0)');
  g.fillStyle = sg;
  g.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  cache.set('__env', env);
  return env;
}

/* ------------------------------------------------------------- pre-bake --- */

const BAKE_ORDER = [
  'asphalt', 'asphalt_fine', 'asphalt_coarse', 'asphalt_red', 'asphalt_green', 'asphalt_blue',
  'concrete', 'concrete_brushed', 'kerb', 'paver', 'sett', 'cobble', 'brick', 'tile',
  'gravel', 'dirt', 'grass', 'planting', 'ballast', 'sleeper', 'steel', 'galv', 'rubber',
  'paint_w', 'paint_y', 'paint_r', 'paint_g', 'paint_b', 'chequer',
];

/** Bake everything, yielding to the browser between surfaces. */
export async function bakeAll(onProgress) {
  for (let i = 0; i < BAKE_ORDER.length; i++) {
    bakeSurface(BAKE_ORDER[i]);
    if (onProgress) onProgress((i + 1) / BAKE_ORDER.length, BAKE_ORDER[i]);
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
  }
  buildSymbolAtlas();
  if (onProgress) onProgress(1, 'symbols');
}

export function disposeTextures() {
  for (const v of cache.values()) {
    if (v?.map) v.map.dispose();
    if (v?.normalMap) v.normalMap.dispose();
    if (v?.dispose) v.dispose();
  }
  cache.clear();
}
