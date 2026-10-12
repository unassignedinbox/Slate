// ---------------------------------------------------------------------------
// HUD — DOM binding + the tactical minimap.
// ---------------------------------------------------------------------------
import { CONFIG, clamp, formatTime } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(track, hazards) {
    this.track = track;
    this.haz = hazards;
    this.el = {
      hud: $('hud'), lap: $('lap'), pos: $('pos'), time: $('time'), best: $('best'), last: $('last'),
      sector: $('sector'), threats: $('threats'), hullpct: $('hullpct'), gap: $('gap'),
      mTurbo: $('mTurbo'), mHull: $('mHull'), mPulse: $('mPulse'), mPulseCd: $('mPulseCd'),
      pulseState: $('pulseState'), speed: $('speed'), speedBar: $('speedBar').firstElementChild,
      map: $('map'), banner: $('banner'), sub: $('subbanner'), countdown: $('countdown'),
      caption: $('caption'), fps: $('fps'), brief: $('briefing'), pause: $('pause'),
      results: $('results'), resultRows: $('resultRows'), resultTitle: $('resultTitle'),
      resultSub: $('resultSub'), pauseInfo: $('pauseInfo'), hullState: $('hullState'),
    };
    this.mctx = this.el.map.getContext('2d');
    this.bannerT = 0;
    this.countT = 0;
    this.threatCache = '';
    this.buildMinimapPath();
    this.buildVignette();
    this._banner = '';
  }

  buildVignette() {
    const v = document.createElement('div');
    v.style.cssText = `position:absolute;inset:0;pointer-events:none;opacity:0;
      background:radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 42%, rgba(10,20,40,.55) 100%);
      transition:opacity .18s ease; mix-blend-mode:screen;`;
    this.el.hud.appendChild(v);
    this.vignette = v;
  }

  /** pre-scale the centreline into minimap space */
  buildMinimapPath() {
    const d = this.track.deck;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < d.n; i += 2) {
      minX = Math.min(minX, d.x[i]); maxX = Math.max(maxX, d.x[i]);
      minZ = Math.min(minZ, d.z[i]); maxZ = Math.max(maxZ, d.z[i]);
    }
    const pad = 26;
    const W = this.el.map.width, H = this.el.map.height;
    const sx = (W - pad * 2) / (maxX - minX), sz = (H - pad * 2) / (maxZ - minZ);
    const s = Math.min(sx, sz);
    this.mapScale = s;
    this.mapOff = {
      x: pad + ((W - pad * 2) - (maxX - minX) * s) / 2 - minX * s,
      y: pad + ((H - pad * 2) - (maxZ - minZ) * s) / 2 - minZ * s,
    };
    this.mapPts = [];
    for (let i = 0; i < d.n; i += 3) {
      this.mapPts.push([d.x[i] * s + this.mapOff.x, d.z[i] * s + this.mapOff.y, i, d.zone[i]]);
    }
    // zone runs for colouring
    this.zoneRuns = [];
    let cur = null;
    for (const [x, y, i, zone] of this.mapPts) {
      if (!cur || cur.zone !== zone) { cur = { zone, pts: [] }; this.zoneRuns.push(cur); }
      cur.pts.push([x, y]);
      void i;
    }
  }

  mm(x, z) { return [x * this.mapScale + this.mapOff.x, z * this.mapScale + this.mapOff.y]; }

  show(screen) {
    this.el.brief.classList.toggle('hidden', screen !== 'briefing');
    this.el.pause.classList.toggle('hidden', screen !== 'pause');
    this.el.results.classList.toggle('hidden', screen !== 'results');
    this.el.hud.classList.toggle('on', screen === 'race' || screen === 'showcase' || screen === 'pause');
  }

  banner(text, sub = '', color = 'cyan', time = 1.5) {
    const b = this.el.banner;
    b.textContent = text;
    b.className = color;
    b.style.opacity = '1';
    this.el.sub.textContent = sub;
    this.el.sub.style.opacity = sub ? '1' : '0';
    this.bannerT = time;
    this._banner = text;
  }

  caption(title, sub) {
    const c = this.el.caption;
    c.innerHTML = `<b>${title}</b><span>${sub || ''}</span>`;
    c.classList.add('on');
    this.captionT = 2.6;
  }

  countdown(v) {
    this.el.countdown.textContent = v;
    this.el.countdown.style.opacity = '1';
  }

  update(race, fps, dt) {
    const p = race.player;
    const el = this.el;
    // ---- timing/position ----
    el.lap.innerHTML = `${Math.min(p.lap + 1, CONFIG.laps)}<small class="dim" style="font-size:13px">/${CONFIG.laps}</small>`;
    const place = p.place;
    el.pos.innerHTML = `${place}<small class="dim" style="font-size:13px">/${race.vehicles.length}</small>`;
    el.time.textContent = formatTime(race.time);
    el.best.textContent = formatTime(p.bestLap);
    el.last.textContent = p.lastLap ? formatTime(p.lastLap) : '--:--.--';
    const zone = this.track.zoneAt(p.s);
    const sectorName = { grid: 'GRID', zipper: 'ZIPPER', traffic: 'TRAFFIC', train: 'MAGLEV', crane: 'CRANE YARD', hairpin: 'HAIRPIN', normal: 'SPINE' }[zone] || 'SPINE';
    el.sector.textContent = sectorName;

    // ---- hull / speed / meters ----
    const hullFrac = clamp(p.hull / CONFIG.hullMax, 0, 1);
    el.mHull.style.width = `${hullFrac * 100}%`;
    el.hullpct.textContent = `${Math.round(hullFrac * 100)}%`;
    el.hullState.textContent = hullFrac > 0.75 ? 'NOMINAL' : hullFrac > 0.45 ? 'STRESSED' : hullFrac > 0.2 ? 'CRITICAL' : 'FAILING';
    el.hullState.style.color = hullFrac > 0.45 ? '' : '#ff8a8a';
    el.mTurbo.style.width = `${clamp(p.energy, 0, 100)}%`;
    const pulseReady = race.pulseCooldown <= 0;
    el.mPulse.style.width = pulseReady ? '100%' : `${clamp(100 - race.pulseCooldown / 8.5 * 100, 0, 100)}%`;
    el.mPulseCd.style.width = `${clamp(race.pulseActive / 2.6 * 100, 0, 100)}%`;
    el.pulseState.textContent = race.pulseActive > 0 ? 'PULSE: PATTERN DRAWN'
      : pulseReady ? 'PULSE: on station' : `PULSE: recharging ${race.pulseCooldown.toFixed(1)}s`;
    const kmh = Math.max(0, p.speedKmh);
    el.speed.textContent = String(Math.round(kmh)).padStart(3, '0');
    el.speedBar.style.width = `${clamp(kmh / (CONFIG.boostTopSpeed * 3.6) * 100, 0, 100)}%`;
    const speedGlow = clamp((p.speed - CONFIG.baseTopSpeed * 0.8) / (CONFIG.boostTopSpeed - CONFIG.baseTopSpeed * 0.8), 0, 1);
    this.vignette.style.opacity = String(speedGlow * 0.8);

    // ---- gap to the car ahead ----
    const ordered = race.positions();
    const me = ordered.indexOf(p);
    const ahead = ordered[me - 1];
    if (ahead) {
      const gapM = race.totalProgress(ahead) - race.totalProgress(p);
      el.gap.textContent = `${gapM > 0 ? '+' : ''}${gapM.toFixed(0)} m`;
      el.gap.style.color = gapM < 0 ? '#a6ff2e' : '';
    } else el.gap.textContent = 'P1 — clear';

    // ---- threats ----
    const threats = this.haz.threatList(p);
    const key = threats.map((t) => `${t.label}${t.active}`).join('|');
    if (key !== this.threatCache) {
      this.threatCache = key;
      el.threats.innerHTML = threats.map((t) => `
        <div class="threat ${t.kind} ${t.active ? 'active' : ''}">
          <span class="dot"></span><span>${t.label}</span>
          <span class="d">${t.active ? 'NOW' : Math.round(t.d) + ' m'}</span>
        </div>`).join('');
    }

    // ---- banners ----
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) { el.banner.style.opacity = '0'; el.sub.style.opacity = '0'; }
    }
    if (race.state === 'countdown') {
      const n = Math.ceil(race.countdown);
      this.countdown(n > 0 ? (n > 3 ? 'READY' : String(n)) : 'GO');
    } else if (el.countdown.style.opacity === '1') {
      this.countdown2 = (this.countdown2 ?? 0) + dt;
      if (this.countdown2 > 0.6) { el.countdown.style.opacity = '0'; this.countdown2 = 0; }
    }
    if (race.caption) this.caption(race.caption.title, race.caption.sub);
    if (this.captionT > 0) {
      this.captionT -= dt;
      if (this.captionT <= 0) el.caption.classList.remove('on');
    }

    el.fps.textContent = `${fps.toFixed(0)} FPS · ${race.state.toUpperCase()}`;
    this.drawMinimap(race);
  }

  drawMinimap(race) {
    const g = this.mctx, W = this.el.map.width, H = this.el.map.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(3,7,14,0.72)';
    g.fillRect(0, 0, W, H);
    // track spine, coloured by district
    const colors = {
      grid: '#7fe9ff', zipper: '#38f2ff', traffic: '#a6ff2e', train: '#ff3b3b',
      crane: '#ff3ec8', hairpin: '#ffb42e', normal: '#4a6b80',
    };
    for (const run of this.zoneRuns) {
      g.strokeStyle = colors[run.zone] || '#4a6b80';
      g.lineWidth = run.zone === 'normal' ? 7 : 10;
      g.lineJoin = 'round';
      g.beginPath();
      run.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    // zipper corridor indicator (where the gaps are right now)
    for (const z of [this.haz.zipper, this.haz.zipper2]) {
      if (!z) continue;
      const p0 = this.mm(this.track.deck.x[z.s0 | 0], this.track.deck.z[z.s0 | 0]);
      const p1 = this.mm(this.track.deck.x[z.s1 | 0], this.track.deck.z[z.s1 | 0]);
      g.strokeStyle = z.pulse.mix > 0.3 ? 'rgba(122,255,216,0.95)' : 'rgba(56,242,255,0.45)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
    }
    // trains: blink when dangerous
    for (const tr of this.haz.trains) {
      const p = this.mm(this.track.deck.x[tr.s | 0], this.track.deck.z[tr.s | 0]);
      const active = tr.state !== 'idle';
      g.fillStyle = active ? (Math.sin(performance.now() * 0.02) > 0 ? '#ff3b3b' : '#5a1010') : '#7a2a2a';
      g.fillRect(p[0] - 5, p[1] - 5, 10, 10);
    }
    // cranes
    for (const c of this.haz.cranes) {
      const p = this.mm(this.track.deck.x[c.s | 0], this.track.deck.z[c.s | 0]);
      g.fillStyle = '#ff3ec8';
      g.beginPath(); g.arc(p[0], p[1], 5, 0, Math.PI * 2); g.fill();
    }
    // start/finish
    {
      const i = (this.track.startS | 0) % this.track.deck.n;
      const p = this.mm(this.track.deck.x[i], this.track.deck.z[i]);
      g.strokeStyle = '#ffffff'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(p[0] - 8, p[1] - 8); g.lineTo(p[0] + 8, p[1] + 8); g.stroke();
    }
    // craft: rivals first, player on top
    for (const v of race.vehicles) {
      const p = this.mm(v.pos.x, v.pos.z);
      const isP = v === race.player;
      g.fillStyle = isP ? '#ffffff' : '#' + v.color.getHexString();
      g.beginPath();
      g.moveTo(p[0], p[1] - (isP ? 8 : 6));
      g.lineTo(p[0] + (isP ? 6 : 4.5), p[1] + (isP ? 6 : 4.5));
      g.lineTo(p[0] - (isP ? 6 : 4.5), p[1] + (isP ? 6 : 4.5));
      g.closePath();
      g.fill();
      if (isP) {
        g.strokeStyle = 'rgba(56,242,255,0.9)';
        g.lineWidth = 2;
        g.beginPath(); g.arc(p[0], p[1], 14, 0, Math.PI * 2); g.stroke();
      }
    }
    void W; void H;
  }

  fillResults(rows, state, time) {
    this.el.resultTitle.textContent = state;
    this.el.resultSub.textContent = time;
    this.el.resultRows.innerHTML = rows.map((r) => `
      <tr class="${r.you ? 'you' : ''}">
        <td>${r.place}</td>
        <td>${r.name}${r.you ? ' <span class="tag">YOU</span>' : ''}</td>
        <td>${r.finished ? formatTime(r.time) : `+${r.gap?.toFixed(1) ?? '--'}s`}</td>
        <td>${formatTime(r.bestLap)}</td>
        <td>${Math.round(r.hull)}%</td>
      </tr>`).join('');
  }
}
