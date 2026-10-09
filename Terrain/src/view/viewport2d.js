// 2-D viewport: draws the evaluated stack as an image (colour, height, the selected layer's mask or layer output, or a named map).
// Painting is handled by the caller through onPaint(nx, ny) with normalised coordinates.

const toByte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

export function createViewport2d(canvas, { onPaint } = {}) {
  const g = canvas.getContext('2d');
  const off = document.createElement('canvas');
  let last = null;
  let painting = false;

  function rgbaFor(result, mode, mapName, layerMask) {
    const N = result.N, out = new Uint8ClampedArray(N * N * 4);
    const put = (i, r, g2, b) => { out[i * 4] = r; out[i * 4 + 1] = g2; out[i * 4 + 2] = b; out[i * 4 + 3] = 255; };
    if (mode === 'colour') {
      for (let i = 0; i < N * N; i++) {
        let r = result.C[i * 3], g2 = result.C[i * 3 + 1], b = result.C[i * 3 + 2];
        const w = result.water[i];
        if (w > 0) { const t = Math.min(1, w / 0.02) * 0.6; r = r * (1 - t) + 0.2 * t; g2 = g2 * (1 - t) + 0.45 * t; b = b * (1 - t) + 0.7 * t; }
        put(i, toByte(r), toByte(g2), toByte(b));
      }
    } else if (mode === 'height') {
      for (let i = 0; i < N * N; i++) { const v = toByte(result.H[i]); put(i, v, v, v); }
    } else if (mode === 'mask') {
      const m = layerMask || null;
      for (let i = 0; i < N * N; i++) { const v = toByte(m ? m[i] : 0); put(i, v, v, v); }
    } else if (mode === 'layer') {
      const pv = result.preview;
      for (let i = 0; i < N * N; i++) {
        if (pv && pv.color) put(i, toByte(pv.color[i * 3]), toByte(pv.color[i * 3 + 1]), toByte(pv.color[i * 3 + 2]));
        else { const v = toByte(pv && pv.height ? pv.height[i] : 0); put(i, v, v, v); }
      }
    } else if (mode === 'map') {
      const m = result.maps[mapName];
      for (let i = 0; i < N * N; i++) {
        if (!m) { put(i, 0, 0, 0); continue; }
        const c = m.ch;
        if (c >= 3) put(i, toByte(m.data[i * c] * 0.5 + 0.5), toByte(m.data[i * c + 1] * 0.5 + 0.5), toByte(m.data[i * c + 2] * 0.5 + 0.5));
        else if (c === 2) put(i, toByte(m.data[i * 2] * 0.5 + 0.5), toByte(m.data[i * 2 + 1] * 0.5 + 0.5), 0);
        else { const v = toByte(m.data[i]); put(i, v, v, v); }
      }
    }
    return out;
  }

  function draw(result, { mode = 'colour', mapName = null, layerMask = null } = {}) {
    last = { result, mode, mapName, layerMask };
    const N = result.N;
    const dpr = window.devicePixelRatio || 1;
    const side = Math.floor(Math.min(canvas.parentElement.clientWidth, canvas.parentElement.clientHeight) * dpr);
    canvas.width = Math.max(1, side);
    canvas.height = Math.max(1, side);
    canvas.style.width = `${side / dpr}px`;
    canvas.style.height = `${side / dpr}px`;
    off.width = N; off.height = N;
    const octx = off.getContext('2d');
    const img = octx.createImageData(N, N);
    img.data.set(rgbaFor(result, mode, mapName, layerMask));
    octx.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  function norm(ev) {
    const r = canvas.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  }
  canvas.addEventListener('pointerdown', (ev) => { if (onPaint) { painting = true; canvas.setPointerCapture(ev.pointerId); onPaint(...norm(ev), 'start'); } });
  canvas.addEventListener('pointermove', (ev) => { if (painting && onPaint) onPaint(...norm(ev), 'move'); });
  const stop = () => { if (painting && onPaint) onPaint(0, 0, 'end'); painting = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  return { draw, redraw: () => last && draw(last.result, last), canvas };
}
