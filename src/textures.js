// Procedural canvas textures: asphalt, paving, grass, ballast and
// painted road symbols (arrows, bikes, BUS, rail-crossing pavement).
import * as THREE from 'three';

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function toTexture(c, repeat = [1, 1], aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noiseOverlay(ctx, size, amount = 18, alpha = 0.55) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
    d[i + 3] = Math.min(255, d[i + 3] * (1 - alpha) + 255 * alpha);
  }
  ctx.putImageData(img, 0, 0);
}

let cache = null;

export function getTextures() {
  if (cache) return cache;

  // ---- asphalt ----
  const asphaltC = canvas(256);
  const actx = asphaltC.getContext('2d');
  actx.fillStyle = '#4b4e55';
  actx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = Math.random() * 2.1 + 0.4;
    actx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
    actx.fillRect(x, y, r, r);
  }
  noiseOverlay(actx, 256, 14, 0.2);

  // ---- bus-lane asphalt (red) ----
  const busC = canvas(256);
  const bctx = busC.getContext('2d');
  bctx.fillStyle = '#6b4a42';
  bctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    bctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,220,190,0.05)' : 'rgba(0,0,0,0.1)';
    bctx.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 2 + 0.5, Math.random() * 2 + 0.5);
  }
  noiseOverlay(bctx, 256, 12, 0.2);

  // ---- cycle asphalt (green) ----
  const cycC = canvas(256);
  const cctx = cycC.getContext('2d');
  cctx.fillStyle = '#3f5747';
  cctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    cctx.fillStyle = Math.random() > 0.5 ? 'rgba(230,255,235,0.05)' : 'rgba(0,0,0,0.09)';
    cctx.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 2 + 0.5, Math.random() * 2 + 0.5);
  }
  noiseOverlay(cctx, 256, 12, 0.2);

  // ---- paving slabs ----
  const pavingC = canvas(256);
  const pctx = pavingC.getContext('2d');
  pctx.fillStyle = '#83858c';
  pctx.fillRect(0, 0, 256, 256);
  const cell = 32;
  for (let y = 0; y < 256; y += cell) {
    for (let x = 0; x < 256; x += cell) {
      const shade = 118 + Math.floor(Math.random() * 26);
      pctx.fillStyle = `rgb(${shade},${shade + 1},${shade + 6})`;
      pctx.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
    }
  }
  noiseOverlay(pctx, 256, 10, 0.15);

  // ---- concrete (curbs / pillars / decks) ----
  const concC = canvas(128);
  const ccctx = concC.getContext('2d');
  ccctx.fillStyle = '#9b9b9b';
  ccctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    ccctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
    ccctx.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
  }
  noiseOverlay(ccctx, 128, 10, 0.2);

  // ---- grass ----
  const grassC = canvas(256);
  const gctx = grassC.getContext('2d');
  gctx.fillStyle = '#4e5c47';
  gctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3200; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const s = 2 + Math.random() * 4;
    gctx.fillStyle = Math.random() > 0.5 ? 'rgba(120,150,95,0.16)' : 'rgba(30,45,25,0.18)';
    gctx.fillRect(x, y, s, s * 0.6);
  }
  noiseOverlay(gctx, 256, 16, 0.2);

  // ---- ballast ----
  const ballC = canvas(128);
  const blctx = ballC.getContext('2d');
  blctx.fillStyle = '#6d6258';
  blctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const r = 1 + Math.random() * 3.4;
    blctx.fillStyle = Math.random() > 0.5 ? '#7d7266' : '#584f46';
    blctx.beginPath();
    blctx.arc(Math.random() * 128, Math.random() * 128, r, 0, Math.PI * 2);
    blctx.fill();
  }

  // ---- gate stripes (red / white) ----
  const gateC = canvas(128);
  const gtctx = gateC.getContext('2d');
  gtctx.fillStyle = '#e8e8e8';
  gtctx.fillRect(0, 0, 128, 128);
  gtctx.fillStyle = '#c23b3b';
  for (let x = -64; x < 192; x += 32) {
    gtctx.beginPath();
    gtctx.moveTo(x, 0);
    gtctx.lineTo(x + 16, 0);
    gtctx.lineTo(x + 16 - 64, 128);
    gtctx.lineTo(x - 64, 128);
    gtctx.closePath();
    gtctx.fill();
  }

  // ---- water ----
  const waterC = canvas(256);
  const wctx = waterC.getContext('2d');
  const grad = wctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#39566b');
  grad.addColorStop(1, '#2c4457');
  wctx.fillStyle = grad;
  wctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    wctx.strokeStyle = 'rgba(255,255,255,0.05)';
    wctx.beginPath();
    const y = Math.random() * 256;
    wctx.moveTo(0, y);
    wctx.bezierCurveTo(64, y + 8, 128, y - 8, 256, y);
    wctx.stroke();
  }

  // ---- painted symbols (white on transparent) ----
  const symbol = (draw, size = 256) => {
    const c = canvas(size);
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,0)';
    x.fillRect(0, 0, size, size);
    draw(x, size);
    return c;
  };

  const arrowStraight = symbol((x, s) => {
    x.fillStyle = '#e9e9e9';
    x.fillRect(s * 0.42, s * 0.5, s * 0.16, s * 0.34); // shaft
    x.beginPath();
    x.moveTo(s * 0.5, s * 0.12);
    x.lineTo(s * 0.72, s * 0.52);
    x.lineTo(s * 0.28, s * 0.52);
    x.closePath();
    x.fill();
  }, 128);

  const arrowLeft = symbol((x, s) => {
    x.fillStyle = '#e9e9e9';
    x.fillRect(s * 0.42, s * 0.52, s * 0.16, s * 0.32);
    x.beginPath();
    x.moveTo(s * 0.5, s * 0.16);
    x.lineTo(s * 0.72, s * 0.56);
    x.lineTo(s * 0.28, s * 0.56);
    x.closePath();
    x.fill();
    x.fillRect(s * 0.18, s * 0.3, s * 0.34, s * 0.14);
    x.beginPath();
    x.moveTo(s * 0.14, s * 0.37);
    x.lineTo(s * 0.3, s * 0.2);
    x.lineTo(s * 0.3, s * 0.54);
    x.closePath();
    x.fill();
  }, 128);

  const arrowRight = symbol((x, s) => {
    x.fillStyle = '#e9e9e9';
    x.fillRect(s * 0.42, s * 0.52, s * 0.16, s * 0.32);
    x.beginPath();
    x.moveTo(s * 0.5, s * 0.16);
    x.lineTo(s * 0.72, s * 0.56);
    x.lineTo(s * 0.28, s * 0.56);
    x.closePath();
    x.fill();
    x.fillRect(s * 0.48, s * 0.3, s * 0.34, s * 0.14);
    x.beginPath();
    x.moveTo(s * 0.86, s * 0.37);
    x.lineTo(s * 0.7, s * 0.2);
    x.lineTo(s * 0.7, s * 0.54);
    x.closePath();
    x.fill();
  }, 128);

  const bikeSymbol = symbol((x, s) => {
    x.strokeStyle = '#e9e9e9';
    x.fillStyle = '#e9e9e9';
    x.lineWidth = s * 0.045;
    x.lineCap = 'round';
    // wheels
    x.beginPath();
    x.arc(s * 0.3, s * 0.62, s * 0.17, 0, Math.PI * 2);
    x.stroke();
    x.beginPath();
    x.arc(s * 0.7, s * 0.62, s * 0.17, 0, Math.PI * 2);
    x.stroke();
    // frame
    x.beginPath();
    x.moveTo(s * 0.3, s * 0.62);
    x.lineTo(s * 0.46, s * 0.38);
    x.lineTo(s * 0.62, s * 0.38);
    x.lineTo(s * 0.7, s * 0.62);
    x.moveTo(s * 0.46, s * 0.38);
    x.lineTo(s * 0.55, s * 0.62);
    x.stroke();
    // rider
    x.beginPath();
    x.arc(s * 0.55, s * 0.2, s * 0.07, 0, Math.PI * 2);
    x.fill();
    x.beginPath();
    x.moveTo(s * 0.55, s * 0.28);
    x.lineTo(s * 0.48, s * 0.38);
    x.stroke();
  }, 128);

  const busText = symbol((x, s) => {
    x.fillStyle = '#f0f0f0';
    x.font = `700 ${s * 0.42}px 'DM Sans', sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('BUS', s / 2, s / 2);
  }, 128);

  const railCrossingPaint = symbol((x, s) => {
    x.strokeStyle = '#f2f2f2';
    x.lineWidth = s * 0.045;
    x.lineCap = 'round';
    // X
    x.beginPath();
    x.moveTo(s * 0.18, s * 0.18);
    x.lineTo(s * 0.42, s * 0.42);
    x.moveTo(s * 0.42, s * 0.18);
    x.lineTo(s * 0.18, s * 0.42);
    x.moveTo(s * 0.58, s * 0.58);
    x.lineTo(s * 0.82, s * 0.82);
    x.moveTo(s * 0.82, s * 0.58);
    x.lineTo(s * 0.58, s * 0.82);
    x.stroke();
    // R R
    x.fillStyle = '#f2f2f2';
    x.font = `700 ${s * 0.22}px 'DM Sans', sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('R', s * 0.3, s * 0.72);
    x.fillText('R', s * 0.7, s * 0.28);
  }, 128);

  const zebraNote = symbol((x, s) => {
    x.fillStyle = '#efefef';
    for (let i = 0; i < 6; i++) x.fillRect(i * (s / 6) + s * 0.03, 0, s / 12, s);
  }, 128);

  cache = {
    asphalt: toTexture(asphaltC, [3, 3]),
    asphaltBus: toTexture(busC, [3, 3]),
    asphaltCycle: toTexture(cycC, [3, 3]),
    paving: toTexture(pavingC, [6, 6]),
    concrete: toTexture(concC, [2, 2]),
    grass: toTexture(grassC, [4, 4]),
    ballast: toTexture(ballC, [8, 8]),
    gate: toTexture(gateC, [3, 1]),
    water: toTexture(waterC, [12, 2]),
    arrowStraight: toTexture(arrowStraight),
    arrowLeft: toTexture(arrowLeft),
    arrowRight: toTexture(arrowRight),
    bikeSymbol: toTexture(bikeSymbol),
    busText: toTexture(busText),
    railCrossingPaint: toTexture(railCrossingPaint),
    zebra: toTexture(zebraNote),
  };
  // Symbol textures should not tile over themselves
  for (const k of ['arrowStraight', 'arrowLeft', 'arrowRight', 'bikeSymbol', 'busText', 'railCrossingPaint', 'zebra']) {
    cache[k].wrapS = cache[k].wrapT = THREE.ClampToEdgeWrapping;
  }
  return cache;
}
