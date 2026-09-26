import { ROADS, TRENCHES, BUNKERS, MOUNDS, WALL, OBJECTIVE, WORLD } from './config.js';
import { clamp, formatTime, lerp } from './util.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      objText: $('objText'),
      objSub: $('objSub'),
      tideText: $('tideText'),
      tideFill: $('tidefill'),
      clock: $('clock'),
      fps: $('fps'),
      hpText: $('hpText'),
      hpFill: $('hpfill'),
      speed: $('speed'),
      warnings: $('warnings'),
      hint: $('hint'),
      flash: $('damageFlash'),
      map: $('minimap'),
      chips: {
        road: $('chipRoad'),
        sand: $('chipSand'),
        water: $('chipWater'),
        wire: $('chipWire'),
        air: $('chipAir'),
      },
      briefing: $('briefing'),
      endScreen: $('endScreen'),
      endTitle: $('endTitle'),
      endText: $('endText'),
      endKicker: $('endKicker'),
      loading: $('loading'),
      loadFill: $('loadFill'),
      loadText: $('loadText'),
      stats: {
        time: $('sTime'),
        dist: $('sDist'),
        hp: $('sHp'),
        mines: $('sMines'),
        tide: $('sTide'),
      },
    };
    this.ctx = this.el.map ? this.el.map.getContext('2d') : null;
    this.warnState = '';
    this.hintTimer = 0;
    this.hintText = '';
    this.flashUntil = 0;
    this._mapStatic = null;
  }

  setLoading(pct, text) {
    if (this.el.loadFill) this.el.loadFill.style.width = `${Math.round(pct * 100)}%`;
    if (text && this.el.loadText) this.el.loadText.textContent = text;
  }

  hideLoading() {
    if (this.el.loading) this.el.loading.style.display = 'none';
  }

  showBriefing(show) {
    this.el.briefing.classList.toggle('hidden', !show);
  }

  showEnd(payload) {
    const { won, title, text, kicker, time, distance, hp, mines, tide } = payload;
    this.el.endScreen.classList.remove('hidden');
    this.el.endTitle.textContent = title;
    this.el.endTitle.style.color = won ? 'var(--teal)' : 'var(--red)';
    this.el.endText.textContent = text;
    this.el.endKicker.textContent = kicker;
    this.el.stats.time.textContent = formatTime(time);
    this.el.stats.dist.textContent = `${Math.round(distance)} m`;
    this.el.stats.hp.textContent = `${Math.round(hp)}%`;
    this.el.stats.mines.textContent = `${mines}`;
    this.el.stats.tide.textContent = `${Math.round(tide * 100)}%`;
  }

  hideEnd() {
    this.el.endScreen.classList.add('hidden');
  }

  hint(text, seconds = 4) {
    if (this.hintText === text && this.hintTimer > 0) return;
    this.hintText = text;
    this.hintTimer = seconds;
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
  }

  flash(intensity = 0.5) {
    const a = clamp(intensity, 0, 1);
    this.el.flash.style.boxShadow = `inset 0 0 ${120 + a * 150}px rgba(190, 40, 26, ${a * 0.8})`;
    this.flashUntil = performance.now() + 140;
  }

  update(dt, s) {
    /* Objective + distance */
    this.el.objSub.textContent = `Distance ${Math.round(s.distanceToObjective)} m · Sector ${s.sector}`;
    this.el.objText.textContent = s.objectiveText;

    /* Tide */
    this.el.tideFill.style.width = `${clamp(s.tideProgress, 0, 1) * 100}%`;
    const tideWords = s.tideProgress < 0.25 ? 'LOW' : s.tideProgress < 0.55 ? 'RISING' : s.tideProgress < 0.82 ? 'HIGH' : 'FLOOD';
    this.el.tideText.textContent = `${tideWords} ${Math.round(s.tideProgress * 100)}%`;

    /* Clock + fps */
    this.el.clock.textContent = formatTime(s.time);
    this.el.fps.textContent = `${Math.round(s.fps)} fps`;

    /* Vehicle */
    const hp = clamp(s.health, 0, 100);
    this.el.hpText.textContent = `${Math.round(hp)}%`;
    this.el.hpFill.style.width = `${hp}%`;
    this.el.hpFill.className = hp < 25 ? 'crit' : hp < 55 ? 'warn' : '';
    this.el.speed.textContent = `${Math.round(s.speed)}`;

    const c = this.el.chips;
    c.road.classList.toggle('on', s.onRoad);
    c.sand.classList.toggle('on', !s.onRoad && !s.inWater);
    c.water.classList.toggle('danger', s.inWater);
    c.wire.classList.toggle('danger', s.inWire);
    c.air.classList.toggle('on', s.airborne);

    /* Warnings */
    const warns = [];
    if (s.underFire) warns.push(['fire', 'Under fire']);
    if (s.mineNear) warns.push(['mine', 'Mines · ' + Math.round(s.mineDistance) + ' m']);
    if (s.drowning) warns.push(['water', 'Engine flooding']);
    if (s.critical) warns.push(['fire', 'Critical damage']);
    const key = warns.map((w) => w[1]).join('|');
    if (key !== this.warnState) {
      this.warnState = key;
      this.el.warnings.innerHTML = warns
        .map(([cls, text]) => `<div class="warn ${cls}">${text}</div>`)
        .join('');
    }

    /* Hint fade */
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.remove('show');
    }
    if (this.flashUntil && performance.now() > this.flashUntil) {
      this.el.flash.style.boxShadow = 'inset 0 0 180px rgba(190, 40, 26, 0)';
      this.flashUntil = 0;
    }

    this.drawMap(s);
  }

  _mapX(x, w) {
    return ((x - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * w;
  }

  _mapY(z, h) {
    return ((z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ)) * h;
  }

  drawMap(s) {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.el.map.width;
    const h = this.el.map.height;
    ctx.clearRect(0, 0, w, h);

    // Sand
    ctx.fillStyle = '#1b2026';
    ctx.fillRect(0, 0, w, h);

    // Water (rises with the tide)
    const shoreY = this._mapY(s.shorelineZ, h);
    const grad = ctx.createLinearGradient(0, shoreY, 0, h);
    grad.addColorStop(0, 'rgba(60,150,170,0.55)');
    grad.addColorStop(1, 'rgba(20,70,95,0.85)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, shoreY, w, h - shoreY);
    ctx.strokeStyle = 'rgba(160,240,235,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, shoreY);
    ctx.lineTo(w, shoreY);
    ctx.stroke();

    // Cover (mounds)
    ctx.fillStyle = 'rgba(120,130,80,0.34)';
    for (const m of MOUNDS) {
      ctx.beginPath();
      ctx.arc(this._mapX(m.x, w), this._mapY(m.z, h), (m.r / (WORLD.maxX - WORLD.minX)) * w, 0, Math.PI * 2);
      ctx.fill();
    }

    // Trenches
    ctx.strokeStyle = 'rgba(150,120,80,0.5)';
    ctx.lineWidth = 2;
    for (const t of TRENCHES) {
      ctx.beginPath();
      t.points.forEach((p, i) => {
        const x = this._mapX(p[0], w);
        const y = this._mapY(p[1], h);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Roads
    ctx.strokeStyle = 'rgba(220,215,200,0.55)';
    ctx.lineWidth = 3;
    for (const r of ROADS) {
      ctx.beginPath();
      r.points.forEach((p, i) => {
        const x = this._mapX(p[0], w);
        const y = this._mapY(p[1], h);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Wall
    const wallY = this._mapY(WALL.z, h);
    ctx.strokeStyle = '#cfd6da';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(this._mapX(-WALL.length / 2, w), wallY);
    ctx.lineTo(this._mapX(WALL.gateX - WALL.gateHalfWidth, w), wallY);
    ctx.moveTo(this._mapX(WALL.gateX + WALL.gateHalfWidth, w), wallY);
    ctx.lineTo(this._mapX(WALL.length / 2, w), wallY);
    ctx.stroke();

    // Bunkers
    for (const b of BUNKERS) {
      ctx.fillStyle = b.kind === 'at' ? '#ff5a45' : '#ff9a6a';
      ctx.beginPath();
      ctx.arc(this._mapX(b.x, w), this._mapY(b.z, h), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Objective
    const ox = this._mapX(OBJECTIVE.x, w);
    const oy = this._mapY(OBJECTIVE.z, h);
    ctx.strokeStyle = '#6cf0c4';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(ox, oy, 9 + Math.sin(performance.now() / 300) * 2, 0, Math.PI * 2);
    ctx.stroke();

    // Player
    const px = this._mapX(s.carX, w);
    const py = this._mapY(s.carZ, h);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-s.carYaw + Math.PI);
    ctx.fillStyle = s.critical ? '#ff5a45' : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Frame
    ctx.strokeStyle = 'rgba(230,220,194,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }
}
