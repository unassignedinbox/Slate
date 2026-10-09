// 2D map view: renders heightmap/albedo/water/maps into a canvas.
import { gradient } from '../engine/grid.js';

export const VIEW_MODES = ['height', 'albedo', 'slope', 'water', 'roughness', 'ao', 'normal', 'moisture', 'snow', 'flowMap', 'scatter', 'density', 'biome', 'treeLine', 'grassLine', 'mineral', 'split'];

export function draw2d(canvas, st, mode, paintOverlay) {
  const N = st.N;
  if (canvas.width !== N) { canvas.width = N; canvas.height = N; }
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N), d = img.data;
  const { gx, gy } = gradient(st.h, N);
  const L = normalize3(-1, 1, 1); // sun from north-west, above
  const scalar = mode !== 'height' && mode !== 'albedo' && mode !== 'slope' && mode !== 'water' && !['normal', 'flowMap'].includes(mode) ? st.maps[mode] : null;
  for (let i = 0; i < N * N; i++) {
    const wet = st.water && !Number.isNaN(st.water[i]);
    let r, g, b;
    if (mode === 'albedo') { r = st.albedo[i * 3]; g = st.albedo[i * 3 + 1]; b = st.albedo[i * 3 + 2]; }
    else if (mode === 'normal' && st.maps.normal) { r = st.maps.normal[i * 3]; g = st.maps.normal[i * 3 + 1]; b = st.maps.normal[i * 3 + 2]; }
    else if (mode === 'flowMap' && st.maps.flowMap) { r = st.maps.flowMap[i * 3]; g = st.maps.flowMap[i * 3 + 1]; b = st.maps.flowMap[i * 3 + 2]; }
    else if (scalar) { r = g = b = scalar[i]; if (mode === 'biome') { const v = scalar[i]; r = 0.5 + 0.5 * Math.sin(v * 9); g = 0.5 + 0.5 * Math.sin(v * 9 + 2); b = 0.5 + 0.5 * Math.sin(v * 9 + 4); } }
    else if (mode === 'slope') { const s = Math.min(1, Math.hypot(gx[i], gy[i]) * 6); r = g = b = s; }
    else if (mode === 'water') { r = g = b = st.h[i] * 0.4; }
    else {
      const nx = -gx[i] * 40, ny = -gy[i] * 40, nz = 1, nl = Math.hypot(nx, ny, nz);
      const shade = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      const v = 0.25 + 0.65 * shade * 0.8 + 0.35 * st.h[i] * 0.5;
      r = g = b = Math.min(1, v);
      if (mode === 'height') { r = Math.min(1, st.h[i] * 0.7 + shade * 0.3); g = r; b = r; }
    }
    if (wet && (mode === 'height' || mode === 'albedo' || mode === 'water')) {
      const a = mode === 'albedo' ? 0.55 : 0.75;
      r = r * (1 - a) + 0.12 * a; g = g * (1 - a) + 0.42 * a; b = b * (1 - a) + 0.82 * a;
    }
    d[i * 4] = clamp(r) * 255; d[i * 4 + 1] = clamp(g) * 255; d[i * 4 + 2] = clamp(b) * 255; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (paintOverlay && paintOverlay.data) {
    // show painted mask as a red tint
    ctx.fillStyle = 'rgba(255,60,60,0.35)';
    const M = paintOverlay.N, p = paintOverlay.data;
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) { const v = p[y * M + x]; if (v > 0.01) { ctx.globalAlpha = Math.min(1, v) * 0.4; ctx.fillRect(x, y, 1, 1); } }
    ctx.globalAlpha = 1;
  }
}
const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function normalize3(x, y, z) { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; }
