// HUD + designer panel (plain DOM; no frameworks, no icons).
const fmt = (t) => {
  if (t == null || !isFinite(t)) return '-:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};
export { fmt };

export class Hud {
  constructor(root, level, opts = {}) {
    this.level = level;
    this.ref = opts.ref || {};
    root.insertAdjacentHTML('beforeend', `
      <div id="hud">
        <div class="tl">
          <div class="lvl">LEVEL 01 <span>/</span> <b id="hSec">SECTION 1</b></div>
          <div class="secname" id="hSecName">FRACTURED TOWN</div>
          <div class="beat" id="hBeat">1A APPROACH ROAD</div>
        </div>
        <div class="tr">
          <div class="time" id="hTime">0:00.00</div>
          <div class="sub"><span id="hRef"></span><span id="hBest"></span></div>
          <div class="split" id="hSplit"></div>
        </div>
        <div class="speedo"><div class="v" id="hSpeed">0</div><div class="u">KM/H</div></div>
        <div class="progress" id="hProg"><div class="fill" id="hFill"></div><div class="ticks" id="hTicks"></div><div class="car" id="hCar"></div></div>
        <canvas id="hMap" width="220" height="220"></canvas>
        <div class="center"><div class="big" id="hBig"></div><div class="msg" id="hMsg"></div></div>
        <div class="help" id="hHelp">
          <b>DRIVE</b> W/S or arrows - A/D steer - Space handbrake - R respawn - Enter restart<br>
          <b>DESIGN</b> G designer panel - T autopilot - C/F/O chase, free, overview cameras - M town motion - P pause - H hide help
        </div>
      </div>
      <div id="designer" class="hidden">
        <div class="dh">LEVEL DESIGN <span>greybox</span></div>
        <div class="dsec" id="dSec"></div>
        <div class="dbeats" id="dBeats"></div>
        <div class="dopts">
          <label><input type="checkbox" id="dMotion" checked> Town motion</label>
          <label><input type="checkbox" id="dFracture" checked> Fracture (crumbling slabs, breakables)</label>
          <label><input type="checkbox" id="dOverlay" checked> Racing line, ticks, labels</label>
          <label><input type="checkbox" id="dDebris" checked> Ambient rubble</label>
          <label class="range">Time scale <input type="range" id="dTime" min="0.1" max="1" step="0.05" value="1"><span id="dTimeV">1.00x</span></label>
        </div>
        <div class="dbtns">
          <button id="dAuto">Autopilot</button><button id="dChase">Chase</button><button id="dFree">Free</button><button id="dOver">Overview</button><button id="dRestart">Restart</button>
        </div>
        <pre id="dStats"></pre>
      </div>`);
    this.$ = (id) => document.getElementById(id);
    this.msgT = 0;
    this.bigT = 0;
    this.splitT = 0;
    this.buildTicks(0);
    this.buildMap(0);
    this.section = 0;
  }

  buildTicks(si) {
    const sec = this.level.sections[si];
    const L = sec.route.length;
    const el = this.$('hTicks');
    el.innerHTML = '';
    for (const b of sec.route.beats) {
      const d = document.createElement('div');
      d.className = 'tick';
      d.style.left = `${(b.s0 / L) * 100}%`;
      d.innerHTML = `<span>${b.id}</span>`;
      d.title = b.name;
      el.appendChild(d);
    }
  }

  buildMap(si) {
    const sec = this.level.sections[si];
    const R = sec.route;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const s of R.samples) { x0 = Math.min(x0, s.p.x); x1 = Math.max(x1, s.p.x); z0 = Math.min(z0, s.p.z); z1 = Math.max(z1, s.p.z); }
    const pad = 14, W = 220, H = 220;
    const sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, z1 - z0));
    const ox = (W - (x1 - x0) * sc) / 2, oz = (H - (z1 - z0) * sc) / 2;
    this.mapT = (p) => [ox + (p.x - x0) * sc, oz + (p.z - z0) * sc];
    const bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    const g = bg.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(20,24,28,0.55)'; g.lineWidth = 7;
    g.beginPath();
    R.samples.forEach((s, i) => { const [x, y] = this.mapT(s.p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    let air = false;
    for (let i = 1; i < R.samples.length; i++) {
      const a = R.samples[i - 1], b = R.samples[i];
      air = b.surface === 'air';
      g.strokeStyle = air ? 'rgba(255,170,130,0.95)' : 'rgba(238,236,228,0.95)';
      g.lineWidth = air ? 1.5 : 3;
      g.beginPath();
      g.moveTo(...this.mapT(a.p)); g.lineTo(...this.mapT(b.p));
      g.stroke();
    }
    g.fillStyle = 'rgba(238,236,228,0.9)';
    g.font = '600 9px system-ui, sans-serif';
    for (const b of R.beats) { const [x, y] = this.mapT(R.at(b.s0).p); g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill(); g.fillText(b.id, x + 4, y - 3); }
    this.mapBg = bg;
  }

  setSection(si) {
    if (si === this.section) return;
    this.section = si;
    const sec = this.level.sections[si];
    this.$('hSec').textContent = `SECTION ${si + 1}`;
    this.$('hSecName').textContent = sec.name;
    this.buildTicks(si);
    this.buildMap(si);
  }

  message(text, secs = 2.5) { this.$('hMsg').textContent = text; this.msgT = secs; }
  big(text, secs = 1) { this.$('hBig').textContent = text; this.bigT = secs; }
  split(text, good) { const el = this.$('hSplit'); el.textContent = text; el.className = 'split ' + (good ? 'good' : 'bad'); this.splitT = 3; }

  update(dt, race, car, extra = {}) {
    this.setSection(race.section);
    const sec = race.sec;
    const t = race.time - race.sectionStart;
    this.$('hTime').textContent = race.practice ? 'PRACTICE' : fmt(t);
    const ref = this.ref[sec.id];
    this.$('hRef').textContent = ref ? `REF ${fmt(ref)}` : '';
    const best = extra.best?.[sec.id];
    this.$('hBest').textContent = best ? `  BEST ${fmt(best)}` : '';
    const b = sec.route.beatAt(race.s);
    this.$('hBeat').textContent = b ? `${b.id}  ${b.name}` : '';
    this.$('hSpeed').textContent = Math.round(Math.abs(car.speed) * 3.6);
    const f = Math.max(0, Math.min(1, race.s / sec.route.length));
    this.$('hFill').style.width = `${f * 100}%`;
    this.$('hCar').style.left = `${f * 100}%`;
    if (race.state === 'countdown') {
      const n = Math.ceil(race.countdown);
      this.$('hBig').textContent = n > 0 ? String(n) : '';
      this.bigT = 0.3;
    }
    this.msgT -= dt; this.bigT -= dt; this.splitT -= dt;
    this.$('hMsg').style.opacity = this.msgT > 0 ? Math.min(1, this.msgT * 2) : 0;
    this.$('hBig').style.opacity = this.bigT > 0 ? Math.min(1, this.bigT * 3) : 0;
    this.$('hSplit').style.opacity = this.splitT > 0 ? Math.min(1, this.splitT * 2) : 0;
    // minimap
    const cv = this.$('hMap');
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(this.mapBg, 0, 0);
    const [x, y] = this.mapT(car.pos);
    car.axes();
    const a = Math.atan2(car.fwd.z, car.fwd.x);
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#e8774f'; g.strokeStyle = '#1a1d20'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, -5); g.lineTo(-3, 0); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}
