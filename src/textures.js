// All textures are drawn procedurally into canvases — nothing is downloaded.
import * as THREE from 'three';

const cache = new Map();
const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};
const finish = (c, rx = 1, ry = 1, aniso = 4) => {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** dark deck plate with panel seams + grip speckle */
export function deckTexture() {
  if (cache.has('deck')) return cache.get('deck');
  const c = canvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#12161f'; g.fillRect(0, 0, 256, 256);
  // subtle noise
  const img = g.getImageData(0, 0, 256, 256), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 1.2;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(90,130,150,0.20)'; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  g.strokeStyle = 'rgba(120,190,210,0.10)'; g.lineWidth = 1;
  for (let i = 32; i <= 256; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
  }
  const t = finish(c, 24, 24);
  cache.set('deck', t);
  return t;
}

/** glowing energy strip (deck edge / lane line) */
export function stripTexture() {
  if (cache.has('strip')) return cache.get('strip');
  const c = canvas(32, 32), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.65, 'rgba(255,255,255,0.95)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  const t = finish(c, 1, 1);
  cache.set('strip', t);
  return t;
}

/** hazard chevrons drawn over the deck for special zones */
export function chevronTexture(color = '#38f2ff', bg = '#0a0e15') {
  const key = 'chev' + color + bg;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(128, 128), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = color; g.globalAlpha = 0.85; g.lineWidth = 12;
  for (let i = -128; i < 256; i += 42) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.lineTo(i, 128); g.stroke();
  }
  g.globalAlpha = 1;
  const t = finish(c, 1, 1);
  cache.set(key, t);
  return t;
}

/** soft radial sprite used for glow blobs and lights */
export function glowTexture() {
  if (cache.has('glow')) return cache.get('glow');
  const c = canvas(64, 64), g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set('glow', t);
  return t;
}

/** vertical window-grid for city towers */
export function windowTexture(hue) {
  const key = 'win' + hue;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(64, 128), g = c.getContext('2d');
  g.fillStyle = '#070a11'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 9) {
    for (let x = 3; x < 62; x += 8) {
      const l = Math.random();
      if (l > 0.55) {
        const a = 0.25 + Math.random() * 0.75;
        g.fillStyle = l > 0.94 ? `hsla(${(hue + Math.random() * 60) | 0},95%,72%,${a})`
          : `hsla(${hue},80%,${45 + Math.random() * 30}%,${a * 0.8})`;
        g.fillRect(x, y, 5, 5);
      }
    }
  }
  const t = finish(c, 1, 1);
  cache.set(key, t);
  return t;
}
