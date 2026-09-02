/**
 * app.js — dashboard UI, input handling and the simulation loop.
 */

import { CARS, getCar } from '../cars.js';
import { Powertrain } from '../model/engine.js';
import { EngineSynth, LISTEN_POSITIONS } from '../audio/graph.js';
import { firingFrequency } from '../model/firing.js';
import { computeTone } from '../model/tone.js';

const $ = (sel) => document.querySelector(sel);
const STEP = 1 / 400; // physics step

export class App {
  constructor() {
    this.ctx = null;
    this.synth = null;
    this.pt = null;
    this.car = null;
    this.state = null;
    this.acc = 0;
    this.last = 0;
    this.keys = new Set();
    this.recorder = null;
    this.recorded = [];
    this.running = false;

    this.buildCarList();
    this.buildPositions();
    this.bindControls();
    this.selectCar(CARS[0].id);
    this.drawTach();
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ------------------------------------------------------------ setup */

  buildCarList() {
    const list = $('#car-list');
    list.innerHTML = '';
    CARS.forEach((car, i) => {
      const b = document.createElement('button');
      b.className = 'car';
      b.dataset.id = car.id;
      b.style.setProperty('--car-accent', car.accent);
      b.innerHTML =
        `<div class="name">${car.make} ${car.model}</div>` +
        `<div class="spec">${car.engine.layout} · ${car.engine.peakPower} hp · ` +
        `${car.engine.redline.toLocaleString()} rpm</div>`;
      b.title = `${i + 1}: ${car.blurb}`;
      b.addEventListener('click', () => this.selectCar(car.id));
      list.appendChild(b);
    });
  }

  buildPositions() {
    const wrap = $('#positions');
    wrap.innerHTML = '';
    const labels = {
      cockpit: 'Cockpit',
      hood: 'Under the hood',
      track: 'Trackside',
      roadside: 'Flyby (Doppler)',
    };
    Object.keys(LISTEN_POSITIONS).forEach((key, i) => {
      const b = document.createElement('button');
      b.className = 'chip' + (i === 0 ? ' on' : '');
      b.dataset.pos = key;
      b.textContent = labels[key] || key;
      b.addEventListener('click', () => {
        wrap.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
        b.classList.add('on');
        if (this.synth) this.synth.setListenPosition(key);
        $('#status-pos').textContent = key;
      });
      wrap.appendChild(b);
    });
  }

  bindControls() {
    $('#start-btn').addEventListener('click', () => this.toggleEngine());
    $('#blip-btn').addEventListener('click', () => this.blip());
    $('#rec-btn').addEventListener('click', () => this.toggleRecord());

    const thr = $('#throttle');
    thr.addEventListener('input', () => {
      if (this.pt) this.pt.setThrottle(+thr.value / 100);
    });

    $('#volume').addEventListener('input', (e) => {
      if (this.synth) this.synth.setMasterVolume(+e.target.value / 100);
    });
    $('#reverb').addEventListener('input', (e) => {
      if (this.synth) this.synth.setReverbAmount(+e.target.value / 100);
    });

    $('#modes').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !this.pt) return;
      $('#modes').querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      this.pt.setMode(b.dataset.mode);
    });
    $('#gearbox').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !this.pt) return;
      $('#gearbox').querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      this.pt.auto = b.dataset.auto === '1';
    });

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', ' ', 'arrowup', 'arrowdown', 'q', 'e', 'r', 'b'].includes(k)) {
      if (document.activeElement && document.activeElement.tagName === 'INPUT' && k === ' ') return;
      e.preventDefault();
    }
    if (down && !e.repeat) {
      this.keys.add(k);
      if (k === 'r') this.toggleEngine();
      if (k === 'b') this.blip();
      if (k === 'e' && this.pt) this.pt.shiftUp();
      if (k === 'q' && this.pt) this.pt.shiftDown();
      const n = parseInt(k, 10);
      if (n >= 1 && n <= CARS.length) this.selectCar(CARS[n - 1].id);
    } else if (!down) {
      this.keys.delete(k);
    }
  }

  readKeys() {
    const up = this.keys.has('w') || this.keys.has('arrowup') || this.keys.has(' ');
    const down = this.keys.has('s') || this.keys.has('arrowdown');
    if (up || down) {
      const v = up ? 1 : 0;
      $('#throttle').value = Math.round(v * 100);
      if (this.pt) {
        this.pt.setThrottle(v);
        this.pt.setBrake(down ? 1 : 0);
      }
    }
  }

  /* --------------------------------------------------------- car select */

  async selectCar(id) {
    const car = getCar(id);
    const wasRunning = this.pt && this.pt.phase === 'run';
    this.car = car;
    document.documentElement.style.setProperty('--accent', car.accent);
    document.querySelectorAll('.car').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    $('#boost-row').style.display = car.engine.aspiration === 'turbo' ? '' : 'none';
    $('#ers-row').style.display = car.hybrid ? '' : 'none';
    $('#car-note').textContent =
      `${car.year} ${car.make} ${car.model} — ${car.engine.name}, ${car.engine.layout}, ` +
      `firing order ${car.engine.firingOrder.join('-')}, ${car.engine.peakPower} hp @ ` +
      `${car.engine.peakPowerRpm.toLocaleString()} rpm, ${car.engine.peakTorque} Nm @ ` +
      `${car.engine.peakTorqueRpm.toLocaleString()} rpm. ${car.gearbox}, final drive ` +
      `${car.finalDrive}. ${car.blurb}`;
    $('#fire-note').textContent = `firing tone marker`;

    this.pt = new Powertrain(car);
    this.drawTach();
    if (this.ctx) {
      if (this.synth) this.synth.dispose();
      this.synth = new EngineSynth(this.ctx, car);
      this.synth.setListenPosition($('#positions .chip.on')?.dataset.pos || 'cockpit');
      this.synth.setMasterVolume(+$('#volume').value / 100);
      this.synth.setReverbAmount(+$('#reverb').value / 100);
      this.synth.start();
      if (wasRunning) this.pt.start();
    }
    this.state = this.pt.snapshot();
  }

  async toggleEngine() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      await this.ctx.resume();
      await this.selectCar(this.car.id);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.pt.phase === 'off') {
      this.pt.start();
      $('#start-btn').textContent = 'Stop engine';
    } else {
      this.pt.shutdown();
      $('#start-btn').textContent = 'Start engine';
    }
  }

  blip() {
    if (!this.pt) return;
    this.pt.blip = 0.55;
  }

  async toggleRecord() {
    if (!this.ctx) return this.toggleEngine();
    const btn = $('#rec-btn');
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.stop();
      return;
    }
    const dest = this.ctx.createMediaStreamDestination();
    this.synth.tap(dest);
    this.recorded = [];
    this.recorder = new MediaRecorder(dest.stream);
    this.recorder.ondataavailable = (e) => e.data.size && this.recorded.push(e.data);
    this.recorder.onstop = () => {
      const blob = new Blob(this.recorded, { type: this.recorder.mimeType || 'audio/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `slate-${this.car.id}-${Date.now()}.webm`;
      a.click();
      btn.classList.remove('recording');
      btn.textContent = '● REC';
    };
    this.recorder.start();
    btn.classList.add('recording');
    btn.textContent = '■ Stop & save';
  }

  /* ------------------------------------------------------------ gauge */

  drawTach() {
    const svg = $('#tach');
    const car = this.car;
    const max = Math.ceil(car.engine.fuelCut / 1000) * 1000;
    const A0 = 135, SWEEP = 270;
    const cx = 160, cy = 160;
    const polar = (r, rpm) => {
      const a = ((A0 + (rpm / max) * SWEEP) * Math.PI) / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const arc = (r, from, to) => {
      const [x0, y0] = polar(r, from);
      const [x1, y1] = polar(r, to);
      const large = (to - from) / max * SWEEP > 180 ? 1 : 0;
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    };
    let html = '';
    html += `<path d="${arc(132, 0, max)}" stroke="rgba(255,255,255,0.09)" stroke-width="10" fill="none" stroke-linecap="round"/>`;
    html += `<path d="${arc(132, car.engine.redline, max)}" stroke="${car.accent}" stroke-width="10" fill="none" opacity="0.85" stroke-linecap="round"/>`;
    for (let r = 0; r <= max; r += 500) {
      const major = r % 1000 === 0;
      const [x0, y0] = polar(major ? 118 : 124, r);
      const [x1, y1] = polar(130, r);
      html += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="rgba(255,255,255,${major ? 0.4 : 0.16})" stroke-width="${major ? 2 : 1}"/>`;
      if (major) {
        const [tx, ty] = polar(102, r);
        html += `<text x="${tx}" y="${ty + 4}" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-size="12" font-family="ui-monospace,monospace">${r / 1000}</text>`;
      }
    }
    html += `<g id="needle"><line x1="${cx}" y1="${cy}" x2="${cx + 122}" y2="${cy}" stroke="${car.accent}" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="7" fill="#0a0c0f" stroke="${car.accent}" stroke-width="2"/></g>`;
    svg.innerHTML = html;
    this._tach = { max, A0, SWEEP };
  }

  setNeedle(rpm) {
    const n = document.getElementById('needle');
    if (!n || !this._tach) return;
    const { max, A0, SWEEP } = this._tach;
    const a = A0 + (Math.min(rpm, max) / max) * SWEEP;
    n.setAttribute('transform', `rotate(${a} 160 160)`);
  }

  /* ------------------------------------------------------------- loop */

  frame(now) {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.readKeys();
    if (this.pt) {
      this.acc += dt;
      let s = null;
      while (this.acc >= STEP) {
        s = this.pt.update(STEP);
        this.acc -= STEP;
      }
      this.state = s || this.pt.snapshot();
      if (this.synth) this.synth.update(this.state, dt);
      this.render(this.state);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  render(s) {
    const car = this.car;
    this.setNeedle(s.rpm);
    $('#rpm-value').textContent = Math.round(s.rpm).toLocaleString();
    $('#gear-value').textContent = s.phase === 'off' ? '—' : s.mode === 'road' ? s.gear : 'N';
    $('#speed-value').innerHTML = `${Math.round(s.speedKph)} <span>km/h</span>`;

    const tone = computeTone(car, s);
    $('#thr-bar').style.width = `${s.throttle * 100}%`;
    $('#thr-out').textContent = `${Math.round(s.throttle * 100)}%`;
    $('#load-bar').style.width = `${tone.load * 100}%`;
    $('#load-out').textContent = `${Math.round(tone.load * 100)}%`;
    if (car.engine.aspiration === 'turbo') {
      $('#boost-bar').style.width = `${Math.min(100, (s.boost / car.engine.maxBoost) * 100)}%`;
      $('#boost-out').textContent = `${s.boost.toFixed(2)} bar`;
    }
    if (car.hybrid) {
      $('#ers-bar').style.width = `${s.soc * 100}%`;
      $('#ers-out').textContent = `${Math.round(s.soc * 100)}%`;
    }

    const led = $('#status-led');
    led.className = 'led ' + (s.phase === 'run' ? 'run' : s.phase === 'off' ? 'off' : 'crank');
    $('#status-text').textContent =
      s.phase === 'off' ? 'engine off' : s.phase === 'cranking' ? 'cranking…' : s.limiter ? 'fuel cut' : 'running';
    if (s.phase === 'off') $('#start-btn').textContent = 'Start engine';
    else if (s.phase !== 'stopping') $('#start-btn').textContent = 'Stop engine';

    const fFire = firingFrequency(s.rpm, car.engine.cylinders);
    const rows = [
      ['engine', car.engine.name],
      ['cylinders', `${car.engine.cylinders} · ${car.engine.layout.split(',')[0]}`],
      ['firing order', car.engine.firingOrder.join('-')],
      ['firing tone', s.rpm > 30 ? `${fFire.toFixed(1)} Hz` : '—'],
      ['torque', `${Math.round(s.torque)} N·m`],
      ['throttle', `${Math.round(s.throttle * 100)}%`],
      ['gear', s.mode === 'road' ? `${s.gear}/${s.gearCount}` : 'neutral'],
      ['speed', `${s.speedKph.toFixed(1)} km/h`],
      ['ERS', car.hybrid ? `${Math.round(s.soc * 100)}% · ${Math.round(s.assist * car.hybrid.kw)} kW` : 'none'],
      ['coolant', `${Math.round(20 + 70 * s.warmup)} °C`],
    ];
    $('#telemetry').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

    this.drawSpectrum(fFire);
  }

  drawSpectrum(fFire) {
    const canvas = $('#spectrum');
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const an = this.synth && this.synth.analyser;
    if (!an) return;
    const bins = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(bins);
    const sr = this.synth.ctx.sampleRate;
    const fMin = 20, fMax = Math.min(12000, sr / 2);
    const xOf = (f) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * W;
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    g.font = '9px ui-monospace, monospace';
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = xOf(f);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, H - 3);
    }
    // spectrum
    g.beginPath();
    g.moveTo(0, H);
    let lastX = 0;
    for (let i = 1; i < bins.length; i++) {
      const f = (i * sr) / 2 / bins.length;
      if (f < fMin) continue;
      if (f > fMax) break;
      const x = xOf(f);
      if (x - lastX > 1.5) { lastX = x; g.lineTo(x, H); }
      const v = bins[i] / 255;
      g.lineTo(x, H - Math.pow(v, 1.2) * (H - 8));
    }
    g.lineTo(W, H);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, this.car.accent);
    grad.addColorStop(1, 'rgba(255,255,255,0.03)');
    g.fillStyle = grad;
    g.fill();
    // firing-tone marker
    if (fFire > fMin && fFire < fMax) {
      const x = xOf(fFire);
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillText(`firing ${fFire.toFixed(0)} Hz`, Math.min(x + 4, W - 90), 11);
    }
  }
}
