import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function asphaltTexture() {
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  g.fillStyle = '#3a3a42';
  g.fillRect(0, 0, 512, 512);
  // grain
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 1.1;
  }
  g.putImageData(img, 0, 0);
  // worn racing-line sheen bands
  g.globalAlpha = 0.16;
  g.fillStyle = '#3c3c47';
  for (let i = 0; i < 26; i++) {
    g.fillRect(Math.random() * 512, 0, 6 + Math.random() * 30, 512);
  }
  // scuff marks
  g.globalAlpha = 0.25;
  g.strokeStyle = '#141416';
  g.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    g.moveTo(x, y);
    g.bezierCurveTo(x + 40, y + 30, x + 90, y - 20, x + 150, y + 10);
    g.stroke();
  }
  g.globalAlpha = 1;
  return finish(c, 3, 1);
}

export function hazardTexture(a = '#f0a81e', b = '#16161a') {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = b;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = a;
  g.save();
  g.translate(0, 0);
  for (let i = -8; i < 16; i++) {
    g.beginPath();
    g.moveTo(i * 32, 0);
    g.lineTo(i * 32 + 16, 0);
    g.lineTo(i * 32 + 16 + 128, 256);
    g.lineTo(i * 32 + 128, 256);
    g.closePath();
    g.fill();
  }
  g.restore();
  // grime
  g.globalAlpha = 0.35;
  g.fillStyle = '#0c0c0f';
  for (let i = 0; i < 120; i++) {
    g.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 20, Math.random() * 6);
  }
  g.globalAlpha = 1;
  return finish(c, 1, 1);
}

export function panelTexture() {
  const c = canvas(512, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#2a2d34';
  g.fillRect(0, 0, 512, 256);
  for (let y = 0; y < 256; y += 64) {
    for (let x = 0; x < 512; x += 64) {
      const v = 34 + Math.random() * 26;
      g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
      g.fillRect(x + 2, y + 2, 60, 60);
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.strokeRect(x + 2, y + 2, 60, 60);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(x + 8, y + 8, 3, 3);
      g.fillRect(x + 53, y + 53, 3, 3);
    }
  }
  // rust streaks
  g.globalAlpha = 0.22;
  for (let i = 0; i < 40; i++) {
    g.fillStyle = ['#7a4a22', '#5a3a1a', '#8a5a2a'][i % 3];
    g.fillRect(Math.random() * 512, Math.random() * 256, 2 + Math.random() * 5, 20 + Math.random() * 70);
  }
  g.globalAlpha = 1;
  return finish(c, 4, 1);
}

export function concreteTexture() {
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  g.fillStyle = '#3a3a3f';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 128) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 512);
    g.moveTo(0, i);
    g.lineTo(512, i);
    g.stroke();
  }
  return finish(c, 40, 40);
}

export function adTexture(text, bg = '#0d1220', fg = '#22e6ff', sub = '') {
  const c = canvas(512, 128);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = fg;
  g.globalAlpha = 0.5;
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 116);
  g.globalAlpha = 1;
  g.fillStyle = fg;
  g.font = 'bold 62px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, sub ? 52 : 64);
  if (sub) {
    g.font = '24px Arial, sans-serif';
    g.globalAlpha = 0.75;
    g.fillText(sub, 256, 96);
    g.globalAlpha = 1;
  }
  return finish(c, 1, 1);
}

export function checkerTexture(n = 8) {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const s = 256 / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? '#111114' : '#e8e8ee';
      g.fillRect(x * s, y * s, s, s);
    }
  }
  return finish(c, 1, 1);
}

export function numberTexture(num = '99', fg = '#f5f7ff', bg = 'rgba(0,0,0,0)') {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  if (bg !== 'rgba(0,0,0,0)') {
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 256);
  }
  g.fillStyle = fg;
  g.font = 'bold 190px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(num, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function shadowTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function smokeTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function crowdTexture() {
  const c = canvas(256, 64);
  const g = c.getContext('2d');
  g.fillStyle = '#14141a';
  g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 900; i++) {
    const h = Math.random();
    g.fillStyle = `hsl(${Math.random() * 360}, ${25 + Math.random() * 40}%, ${18 + Math.random() * 45}%)`;
    g.fillRect(Math.random() * 256, Math.random() * 64, 2 + h * 3, 2 + h * 3);
  }
  return finish(c, 20, 1);
}
