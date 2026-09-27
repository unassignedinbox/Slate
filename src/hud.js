// ============================================================================
// hud.js — DOM heads-up display: timing tower, speedo, nitro bar, minimap,
// center messages, lap delta flashes.
// ============================================================================
export class HUD {
  constructor(track) {
    this.track = track;
    this.el = {
      hud: document.getElementById('hud'),
      lap: document.getElementById('lap'),
      cur: document.getElementById('cur'),
      last: document.getElementById('last'),
      best: document.getElementById('best'),
      speed: document.getElementById('speed'),
      gear: document.getElementById('gear'),
      nitrofill: document.getElementById('nitrofill'),
      nitropc: document.getElementById('nitropc'),
      msg: document.getElementById('msg'),
      lapflash: document.getElementById('lapflash'),
    };
    this.map = document.getElementById('minimap');
    this.mctx = this.map.getContext('2d');
    this._flashTimeout = null;
    this._buildMapBase();
  }

  show() { this.el.hud.classList.add('on'); }

  static fmt(ms) {
    if (ms == null || !isFinite(ms)) return '--:--.---';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const mm = Math.floor(ms % 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
  }

  _buildMapBase() {
    const t = this.track;
    const W = this.map.width, H = this.map.height;
    // fit extents
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.N; i++) {
      const p = t.sPos[i];
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 26;
    const sx = (W - pad * 2) / (maxX - minX);
    const sz = (H - pad * 2) / (maxZ - minZ);
    const s = Math.min(sx, sz);
    this._mapX = x => pad + (x - minX) * s + (W - pad * 2 - (maxX - minX) * s) / 2;
    this._mapZ = z => pad + (z - minZ) * s + (H - pad * 2 - (maxZ - minZ) * s) / 2;

    // offscreen base: track ribbon outline + start line
    this._mapBase = document.createElement('canvas');
    this._mapBase.width = W; this._mapBase.height = H;
    const g = this._mapBase.getContext('2d');
    g.fillStyle = 'rgba(6,12,18,0.9)';
    g.fillRect(0, 0, W, H);

    const drawEdge = (off) => {
      g.beginPath();
      for (let i = 0; i <= t.N; i++) {
        const idx = i % t.N;
        const p = t.sPos[idx], side = t.sSide[idx];
        const x = p.x + side.x * off, z = p.z + side.z * off;
        if (i === 0) g.moveTo(this._mapX(x), this._mapZ(z));
        else g.lineTo(this._mapX(x), this._mapZ(z));
      }
      g.stroke();
    };
    g.lineWidth = 7;
    g.strokeStyle = '#4b525c';
    drawEdge(0); // centerline fat = road body
    g.lineWidth = 7;
    g.strokeStyle = '#20242b';
    drawEdge(0);
    // hazard edges
    g.lineWidth = 1.5;
    g.strokeStyle = '#e8b90c';
    drawEdge(-10); drawEdge(10);

    // start line tick
    const p0 = t.sPos[0], s0 = t.sSide[0];
    g.strokeStyle = '#f2f5f7';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(this._mapX(p0.x - s0.x * 11), this._mapZ(p0.z - s0.z * 11));
    g.lineTo(this._mapX(p0.x + s0.x * 11), this._mapZ(p0.z + s0.z * 11));
    g.stroke();

    // corner name labels, tiny
    g.fillStyle = 'rgba(126,183,199,0.85)';
    g.font = '700 11px Arial';
    g.textAlign = 'center';
    const label = (i, txt) => {
      const p = t.sPos[Math.floor(i) % t.N];
      g.fillText(txt, this._mapX(p.x), this._mapZ(p.z) - 8);
    };
    label(t.N * 0.19, 'T1');
    label(t.N * 0.47, 'ESSES');
    label(t.N * 0.70, 'FACTORY TURN');
    label(t.N * 0.9, 'T5');
  }

  drawMap(x, z, yaw, progress) {
    const g = this.mctx;
    g.clearRect(0, 0, this.map.width, this.map.height);
    g.drawImage(this._mapBase, 0, 0);
    // car arrow — world forward = (sin yaw, cos yaw) in (x,z); screen x=x, y=z.
    // Canvas rotate(a) maps the drawn up-tip (0,-1) to (sin a, -cos a);
    // solving (sin a, -cos a) = (sin yaw, cos yaw) gives a = π − yaw.
    const mx = this._mapX(x), mz = this._mapZ(z);
    g.save();
    g.translate(mx, mz);
    g.rotate(Math.PI - yaw);
    g.fillStyle = '#2ee6ff';
    g.beginPath();
    g.moveTo(0, -6.5); g.lineTo(4.4, 5); g.lineTo(-4.4, 5); g.closePath();
    g.fill();
    g.strokeStyle = '#043038'; g.lineWidth = 1.2; g.stroke();
    g.restore();
  }

  update({ lap, curMs, lastMs, bestMs, kmh, gearLabel, nitro, boosting }) {
    this.el.lap.textContent = lap;
    this.el.cur.textContent = HUD.fmt(curMs);
    this.el.last.textContent = HUD.fmt(lastMs);
    this.el.best.textContent = bestMs ? HUD.fmt(bestMs) : '--:--.---';
    this.el.speed.innerHTML = `${Math.round(kmh)}<small> KM/H</small>`;
    this.el.gear.textContent = gearLabel;
    this.el.nitrofill.style.width = `${Math.round(nitro * 100)}%`;
    this.el.nitrofill.classList.toggle('boosting', boosting);
    this.el.nitropc.textContent = `${Math.round(nitro * 100)}%`;
  }

  message(html, ms = 1400) {
    this.el.msg.innerHTML = html;
    this.el.msg.style.opacity = 1;
    clearTimeout(this._msgTimeout);
    this._msgTimeout = setTimeout(() => { this.el.msg.style.opacity = 0; }, ms);
  }

  lapFlash(text, good) {
    const el = this.el.lapflash;
    el.textContent = text;
    el.className = good ? 'show good' : 'show bad';
    clearTimeout(this._flashTimeout);
    this._flashTimeout = setTimeout(() => { el.className = ''; }, 2600);
  }
}
