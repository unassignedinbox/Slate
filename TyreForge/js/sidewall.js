/* ============================================================================
 * TyreForge — sidewall.js
 * Procedural sidewall artwork: brand / model lettering, size codes, rotation
 * arrows, wear markers — painted onto a polar canvas (u = around, v = out).
 * v = 0 → bead (near rim),  v = 1 → tread edge.
 * ========================================================================== */

'use strict';

export function drawSidewall(o) {
  const W = 2048, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  /* v helper: canvas y (0=top) is drawn so that flipY maps canvas-bottom → v=0
   * (bead). So we position elements by v directly: y = (1 - v) * H           */
  const vy = v => (1 - v) * H;

  /* ---------- base rubber ---------- */
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#2c2c2f');      // shoulder
  grad.addColorStop(0.35, '#232326');   // mid
  grad.addColorStop(0.8, '#1d1d20');    // lower
  grad.addColorStop(1, '#17171a');      // bead
  g.fillStyle = grad; g.fillRect(0, 0, W, H);

  /* fine circumferential mould lines */
  g.globalAlpha = 0.5;
  for (let i = 0; i < 26; i++) {
    const v = 0.03 + i * 0.036;
    g.strokeStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.16)';
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, vy(v)); g.lineTo(W, vy(v)); g.stroke();
  }
  g.globalAlpha = 1;

  /* speckle */
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
    g.fillRect(x, y, 1.6, 1.6);
  }

  /* bead rim-protector band */
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, vy(0.10), W, vy(0.0) - vy(0.10));
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, vy(0.105), W, 3);

  /* coloured race ring */
  if (o.ring) {
    g.fillStyle = o.ring;
    g.fillRect(0, vy(0.165), W, vy(0.135) - vy(0.165));
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, vy(0.135), W, 2.5); g.fillRect(0, vy(0.168), W, 2.5);
  }

  /* balance dot */
  g.fillStyle = '#e8c832'; g.beginPath(); g.arc(W * 0.07, vy(0.19), 7, 0, 7); g.fill();

  /* ---------- text ---------- */
  const repeats = o.aspect > 0.42 ? 3 : 2;
  const block = W / repeats;
  const mirror = !!o.mirror;

  const setFont = (px, weight = 'bold', fam = 'Arial Narrow, Arial') =>
    g.font = `${weight} ${px}px ${fam}`;

  /* embossed rubber text: pass 1 shadow, pass 2 highlight */
  const rubberText = (txt, cx, cy, px, col, emboss = 2.4, weight = 'bold') => {
    setFont(px, weight);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText(txt, cx, cy + emboss);
    g.fillStyle = col;
    g.fillText(txt, cx, cy);
  };

  for (let r = 0; r < repeats; r++) {
    g.save();
    const cx0 = (r + 0.5) * block;
    if (mirror) { g.translate(W, 0); g.scale(-1, 1); }
    const cx = mirror ? W - cx0 : cx0;

    const brandCol = o.raised ? '#e8e8ea' : '#55555c';
    const modelCol = o.raised ? '#d2d2d6' : '#4c4c54';

    /* brand — the big lettering */
    rubberText(spaced(o.brand || 'SLATEWERKS'), cx, vy(0.56), H * 0.155, brandCol);
    /* model */
    rubberText(o.model || '', cx, vy(0.42), H * 0.105, modelCol);
    /* size + service description */
    rubberText(`${o.sizeText}  ${o.loadIdx}`, cx, vy(0.29), H * 0.068, '#3f3f46', 2);
    /* extra line: e.g. RACING SLICK · TW60 */
    rubberText(o.line1 || '', cx, vy(0.225), H * 0.052, '#38383f', 2, 'normal');
    /* standard markings */
    rubberText(`RADIAL  TUBELESS     MAX LOAD 730kg     DOT N4X7 ${(2600 + r * 137) % 10000}`, cx, vy(0.145), H * 0.042, '#333339', 1.6, 'normal');

    /* rotation arrows */
    if (o.arrow) {
      for (let k = 0; k < 2; k++) {
        const ax = cx + (k ? 1 : -1) * block * 0.31;
        drawArrow(g, ax, vy(0.49), H * 0.06, '#45454d');
        rubberText('ROTATION', ax, vy(0.615), H * 0.038, '#38383f', 1.5, 'normal');
      }
    }

    /* tread-wear indicator triangles pointing at shoulder */
    g.fillStyle = '#48484f';
    for (let k = 0; k < 2; k++) {
      const tx = cx + (k ? 1 : -1) * block * 0.30;
      const yy = vy(0.82);
      g.beginPath(); g.moveTo(tx - 9, yy); g.lineTo(tx + 9, yy); g.lineTo(tx, yy - 12);
      g.closePath(); g.fill();
      setFont(H * 0.034, 'normal');
      g.textAlign = 'center';
      g.fillStyle = '#3a3a41';
      g.fillText('TWI', tx, yy + 12);
    }
    g.restore();
  }

  return c;
}

function spaced(s) { return s.split('').join(' '); }

function drawArrow(g, x, y, s, col) {
  g.save(); g.translate(x, y);
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = s * 0.16;
  g.lineCap = 'round';
  g.beginPath(); g.arc(0, 0, s, Math.PI * 0.25, Math.PI * 1.5); g.stroke();
  const a = Math.PI * 1.5;
  const hx = Math.cos(a) * s, hy = Math.sin(a) * s;
  g.beginPath();
  g.moveTo(hx + s * 0.34, hy - s * 0.05);
  g.lineTo(hx - s * 0.10, hy - s * 0.34);
  g.lineTo(hx - s * 0.12, hy + s * 0.24);
  g.closePath(); g.fill();
  g.restore();
}
