/** DOM heads-up display: speed, laps, boost, minimap. */
export function fmtTime(ms) {
  if (ms === null || ms === undefined || !isFinite(ms)) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = Math.floor(ms % 1000);
  return `${String(m).padStart(1, '0')}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
}

export class HUD {
  constructor(track) {
    this.track = track;
    this.el = {
      speed: document.getElementById('speed'),
      gear: document.getElementById('gear'),
      boostFill: document.getElementById('boostFill'),
      lap: document.getElementById('lap'),
      cur: document.getElementById('curTime'),
      best: document.getElementById('bestTime'),
      last: document.getElementById('lastTime'),
      sector: document.getElementById('sector'),
      msg: document.getElementById('bigMsg'),
      sub: document.getElementById('subMsg'),
      cam: document.getElementById('camMode'),
      livery: document.getElementById('liveryName'),
      fps: document.getElementById('fps'),
      needle: document.getElementById('needle'),
    };
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this._prepMap();
  }

  _prepMap() {
    const pts = this.track.outline(5);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const pad = 14;
    const w = this.map.width;
    const h = this.map.height;
    const sx = (w - pad * 2) / (maxX - minX);
    const sz = (h - pad * 2) / (maxZ - minZ);
    const s = Math.min(sx, sz);
    this.mapT = (x, z) => [pad + (x - minX) * s + (w - pad * 2 - (maxX - minX) * s) / 2, pad + (z - minZ) * s + (h - pad * 2 - (maxZ - minZ) * s) / 2];
    this.mapPts = pts;
  }

  drawMap(car, ghostIdx = null) {
    const g = this.mapCtx;
    const w = this.map.width;
    const h = this.map.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(6,10,18,0.72)';
    g.fillRect(0, 0, w, h);

    // track ribbon, drawn low-to-high so the bridge reads on top
    const pts = this.mapPts;
    const order = pts.map((p, i) => i).sort((a, b) => pts[a][2] - pts[b][2]);
    g.lineCap = 'round';
    for (const i of order) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (Math.abs(a[2] - b[2]) > 6) continue;
      const [x1, y1] = this.mapT(a[0], a[1]);
      const [x2, y2] = this.mapT(b[0], b[1]);
      const t = Math.min(1, Math.max(0, a[2] / 18));
      g.strokeStyle = `rgba(${40 + t * 60}, ${150 + t * 60}, ${200 + t * 40}, ${0.55 + t * 0.4})`;
      g.lineWidth = 3 + t * 2.4;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }

    // start line
    const s = this.track.centers[this.track.startIndex];
    const [sxp, syp] = this.mapT(s.x, s.z);
    g.fillStyle = '#ffb01e';
    g.fillRect(sxp - 3, syp - 3, 6, 6);

    if (ghostIdx !== null) {
      const c = this.track.centers[ghostIdx];
      const [gx, gy] = this.mapT(c.x, c.z);
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.beginPath();
      g.arc(gx, gy, 3, 0, 7);
      g.fill();
    }

    // car
    const [cx, cy] = this.mapT(car.position.x, car.position.z);
    g.save();
    g.translate(cx, cy);
    g.rotate(-car.yaw + Math.PI);
    g.fillStyle = '#ff3fa8';
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4.2, 5);
    g.lineTo(0, 2.6);
    g.lineTo(-4.2, 5);
    g.closePath();
    g.fill();
    g.restore();
  }

  update(state) {
    const e = this.el;
    e.speed.textContent = String(Math.round(state.kmh)).padStart(3, '0');
    e.gear.textContent = state.gear === 0 ? 'R' : state.gear;
    e.boostFill.style.width = `${Math.round(state.boost * 100)}%`;
    e.boostFill.classList.toggle('burning', state.boosting);
    e.lap.textContent = `${state.lap}/${state.totalLaps}`;
    e.cur.textContent = fmtTime(state.current);
    e.best.textContent = fmtTime(state.best);
    e.last.textContent = fmtTime(state.last);
    e.sector.textContent = state.section;
    e.cam.textContent = state.camName;
    e.livery.textContent = state.livery;
    e.fps.textContent = `${state.fps} FPS`;
    const deg = -120 + Math.min(1, state.kmh / 340) * 240;
    e.needle.style.transform = `rotate(${deg}deg)`;
  }

  message(main, sub = '', ms = 1600) {
    this.el.msg.textContent = main;
    this.el.sub.textContent = sub;
    this.el.msg.classList.add('show');
    clearTimeout(this._msgT);
    if (ms > 0) {
      this._msgT = setTimeout(() => this.el.msg.classList.remove('show'), ms);
    }
  }
}
