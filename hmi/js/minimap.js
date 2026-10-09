// Track outline renderer for minimaps (any app can draw markers on the same map).
import { TRACK } from './track.js';

export function createTrackMap(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ctx = canvas.getContext('2d');
  let path = null, b = null;

  const toXY = (p) => {
    const s = Math.min((b.w - 24) / (b.x1 - b.x0), (b.h - 24) / (b.y1 - b.y0));
    const ox = (b.w - (b.x1 - b.x0) * s) / 2, oy = (b.h - (b.y1 - b.y0) * s) / 2;
    return [ox + (p.x - b.x0) * s, b.h - (oy + (p.y - b.y0) * s)];
  };

  function build() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 200;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const xs = TRACK.points.map((p) => p.x), ys = TRACK.points.map((p) => p.y);
    b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), w, h };
    path = new Path2D();
    TRACK.points.forEach((p, i) => { const [X, Y] = toXY(p); i ? path.lineTo(X, Y) : path.moveTo(X, Y); });
    path.closePath();
  }
  const ro = new ResizeObserver(build);
  ro.observe(canvas);
  build();

  // markers: [{ pos: {x,y}, color, r, label? }]
  function draw(markers) {
    ctx.clearRect(0, 0, b.w, b.h);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.stroke(path);
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(46,230,197,0.85)'; ctx.stroke(path);
    for (const m of markers) {
      const [X, Y] = toXY(m.pos);
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(X, Y, m.r ?? 5, 0, Math.PI * 2); ctx.fill();
      if (m.label) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '600 11px system-ui';
        ctx.fillText(m.label, X + 8, Y - 6);
      }
    }
  }
  return { draw, dispose() { ro.disconnect(); } };
}
