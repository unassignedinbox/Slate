import * as THREE from 'three';
import { makeNoise } from './noise.js';

// -----------------------------------------------------------------------
// Fully procedural PBR-ish texture generation (color + normal + roughness)
// built from fractal noise. Everything here runs once at load time and is
// cached as CanvasTexture / DataTexture, so there are no external image
// assets to fetch — useful for a self-contained, offline-safe build.
// -----------------------------------------------------------------------

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

/**
 * Builds a tileable-ish heightfield with fbm noise (domain wrapped with a
 * cosine falloff at the border isn't perfect tiling, but the repeat
 * frequency + multi-octave detail hides seams well at the scales we use).
 */
function buildHeightfield(size, seed, { freq = 4, octaves = 5, warp = 0, ridged = false } = {}) {
  const { fbm2, n2 } = makeNoise(seed);
  const data = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let u = x / size, v = y / size;
      if (warp > 0) {
        u += warp * n2(u * 3.1 + 11, v * 3.1 - 7);
        v += warp * n2(u * 3.1 - 5, v * 3.1 + 13);
      }
      let h = fbm2(u * freq, v * freq, octaves);
      if (ridged) h = 1 - Math.abs(h);
      data[y * size + x] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  // normalize to 0..1
  const range = Math.max(1e-6, max - min);
  for (let i = 0; i < data.length; i++) data[i] = (data[i] - min) / range;
  return data;
}

function heightToNormalMap(size, heights, strength = 2.2) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = at(x - 1, y), hr = at(x + 1, y);
      const hd = at(x, y - 1), hu = at(x, y + 1);
      const dx = (hl - hr) * strength;
      const dy = (hd - hu) * strength;
      const nx = dx, ny = dy, nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const idx = (y * size + x) * 4;
      img.data[idx + 0] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[idx + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function heightToColorMap(size, heights, ramp) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const tmp = new THREE.Color();
  for (let i = 0; i < size * size; i++) {
    ramp(heights[i], tmp, i, size);
    img.data[i * 4 + 0] = Math.round(THREE.MathUtils.clamp(tmp.r, 0, 1) * 255);
    img.data[i * 4 + 1] = Math.round(THREE.MathUtils.clamp(tmp.g, 0, 1) * 255);
    img.data[i * 4 + 2] = Math.round(THREE.MathUtils.clamp(tmp.b, 0, 1) * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function heightToScalarMap(size, heights, curve) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(THREE.MathUtils.clamp(curve(heights[i]), 0, 1) * 255);
    img.data[i * 4 + 0] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function toTexture(canvas, { srgb = false, repeat = 1 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function buildRockTextureSet(seed = 7, size = 512) {
  const heights = buildHeightfield(size, seed, { freq: 5, octaves: 6, warp: 0.6, ridged: true });
  const fine = buildHeightfield(size, seed + 99, { freq: 24, octaves: 3 });
  const mixed = new Float32Array(size * size);
  for (let i = 0; i < mixed.length; i++) mixed[i] = heights[i] * 0.78 + fine[i] * 0.22;

  const colorCanvas = heightToColorMap(size, mixed, (h, c) => {
    const dark = new THREE.Color(0x0d0a08);
    const mid = new THREE.Color(0x241a14);
    const wet = new THREE.Color(0x2e2a26);
    const light = new THREE.Color(0x4a3a2c);
    if (h < 0.35) c.copy(dark).lerp(mid, h / 0.35);
    else if (h < 0.7) c.copy(mid).lerp(wet, (h - 0.35) / 0.35);
    else c.copy(wet).lerp(light, (h - 0.7) / 0.3);
  });
  const normalCanvas = heightToNormalMap(size, mixed, 3.4);
  const roughCanvas = heightToScalarMap(size, mixed, (h) => 0.95 - h * 0.25);

  return {
    map: toTexture(colorCanvas, { srgb: true, repeat: 6 }),
    normalMap: toTexture(normalCanvas, { repeat: 6 }),
    roughnessMap: toTexture(roughCanvas, { repeat: 6 }),
    heights: mixed,
    size,
  };
}

export function buildGroundTextureSet(seed = 21, size = 512) {
  const heights = buildHeightfield(size, seed, { freq: 8, octaves: 5, warp: 0.4 });
  const colorCanvas = heightToColorMap(size, heights, (h, c) => {
    const dark = new THREE.Color(0x120c07);
    const mid = new THREE.Color(0x241708);
    const light = new THREE.Color(0x3a2612);
    if (h < 0.5) c.copy(dark).lerp(mid, h / 0.5);
    else c.copy(mid).lerp(light, (h - 0.5) / 0.5);
  });
  const normalCanvas = heightToNormalMap(size, heights, 2.6);
  const roughCanvas = heightToScalarMap(size, heights, () => 0.92);
  return {
    map: toTexture(colorCanvas, { srgb: true, repeat: 10 }),
    normalMap: toTexture(normalCanvas, { repeat: 10 }),
    roughnessMap: toTexture(roughCanvas, { repeat: 10 }),
    heights,
    size,
  };
}

// Fine mottled chitin (exoskeleton) texture used on the carapace / leg
// segments beneath the fur layer, and visible on the glossy leg tips.
export function buildChitinTextureSet(seed = 5, size = 256, baseColor = 0x0c0906, accent = 0x1c120b) {
  const heights = buildHeightfield(size, seed, { freq: 10, octaves: 4 });
  const base = new THREE.Color(baseColor);
  const acc = new THREE.Color(accent);
  const colorCanvas = heightToColorMap(size, heights, (h, c) => {
    c.copy(base).lerp(acc, Math.pow(h, 1.6));
  });
  const normalCanvas = heightToNormalMap(size, heights, 1.4);
  const roughCanvas = heightToScalarMap(size, heights, (h) => 0.35 + h * 0.25);
  return {
    map: toTexture(colorCanvas, { srgb: true, repeat: 1 }),
    normalMap: toTexture(normalCanvas, { repeat: 1 }),
    roughnessMap: toTexture(roughCanvas, { repeat: 1 }),
  };
}
