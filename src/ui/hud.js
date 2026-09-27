import { clamp } from '../util/mathx.js';
import { COURSE } from '../config.js';

// DOM head-up display + tactical minimap.

const MAP_W = 220;
const MAP_H = 300;

export class HUD {
  constructor(root, roads) {
    this.roads = roads;
    root.innerHTML = `
      <div id="hud" class="hidden">
        <div class="panel tl">
          <div class="label">OBJECTIVE</div>
          <div class="big" id="objective">REACH THE GATE</div>
          <div class="row"><span>DISTANCE</span><b id="dist">0 m</b></div>
          <div class="bar"><i id="progressBar"></i></div>
        </div>

        <div class="panel tr">
          <div class="label">TIDE</div>
          <div class="big" id="tideState">RISING</div>
          <div class="row"><span>SEA LEVEL</span><b id="tideLevel">0.0 m</b></div>
          <div class="row"><span>WATERLINE</span><b id="tideGap">0 m</b></div>
          <div class="bar danger"><i id="tideBar"></i></div>
        </div>

        <div class="panel bl">
          <div class="label">HULL</div>
          <div class="bar health"><i id="healthBar"></i></div>
          <div class="row"><span id="statusText">NOMINAL</span><b id="healthVal">100%</b></div>
        </div>

        <div class="speedo">
          <b id="speed">0</b><span>KM/H</span>
          <div class="gear" id="surface">SAND</div>
        </div>

        <canvas id="minimap" width="${MAP_W}" height="${MAP_H}"></canvas>

        <div id="warnings"></div>
        <div id="hitflash"></div>
      </div>

      <div id="overlay">
        <div class="card" id="card">
          <h1>OPERATION <span>SLATE</span></h1>
          <h2>D-DAY &mdash; THE RUN TO THE WALL</h2>
          <p>
            You are ashore in a requisitioned saloon with the tide coming in behind you.
            Three kilometres of defended beachhead lie between you and the gate in the
            Atlantic Wall &mdash; minefields, wire, dragon&rsquo;s teeth, dug-in armour,
            and machine-gun bunkers with interlocking arcs of fire.
          </p>
          <ul>
            <li><b>W / &uarr;</b> throttle &nbsp; <b>S / &darr;</b> brake &amp; reverse &nbsp; <b>A D / &larr;&rarr;</b> steer</li>
            <li><b>C</b> camera &nbsp; <b>M</b> mute &nbsp; <b>P</b> pause &nbsp; <b>R</b> restart</li>
            <li>Mounds, trenches and wrecks break line of sight &mdash; the gunners cannot hit what they cannot see.</li>
            <li>Teller mines are the big steel plates with the cross on top. They will end you.</li>
            <li>The sea is rising. Standing still is a decision.</li>
          </ul>
          <button id="startBtn">START THE RUN</button>
        </div>
      </div>
    `;

    this.hud = root.querySelector('#hud');
    this.overlay = root.querySelector('#overlay');
    this.card = root.querySelector('#card');
    this.el = {
      dist: root.querySelector('#dist'),
      progressBar: root.querySelector('#progressBar'),
      tideState: root.querySelector('#tideState'),
      tideLevel: root.querySelector('#tideLevel'),
      tideGap: root.querySelector('#tideGap'),
      tideBar: root.querySelector('#tideBar'),
      healthBar: root.querySelector('#healthBar'),
      healthVal: root.querySelector('#healthVal'),
      statusText: root.querySelector('#statusText'),
      speed: root.querySelector('#speed'),
      surface: root.querySelector('#surface'),
      warnings: root.querySelector('#warnings'),
      hitflash: root.querySelector('#hitflash'),
      objective: root.querySelector('#objective'),
    };
    this.canvas = root.querySelector('#minimap');
    this.ctx = this.canvas.getContext('2d');
    this.startBtn = root.querySelector('#startBtn');
    this.warnTimers = new Map();
  }

  show() {
    this.hud.classList.remove('hidden');
    this.overlay.classList.add('hidden');
  }

  warn(text, seconds = 2) {
    this.warnTimers.set(text, Math.max(this.warnTimers.get(text) || 0, seconds));
  }

  flash(strength = 1) {
    this.el.hitflash.style.opacity = String(clamp(strength, 0, 1) * 0.55);
  }

  end(won, stats) {
    this.overlay.classList.remove('hidden');
    this.card.innerHTML = won
      ? `<h1 class="win">THROUGH THE GATE</h1>
         <h2>The wall is behind you.</h2>
         <ul class="stats">
           <li><span>TIME</span><b>${stats.time}</b></li>
           <li><span>HULL REMAINING</span><b>${stats.health}%</b></li>
           <li><span>GROUND COVERED</span><b>${stats.distance} m</b></li>
           <li><span>MINES TRIPPED</span><b>${stats.mines}</b></li>
           <li><span>ROUNDS TAKEN</span><b>${stats.hits}</b></li>
           <li><span>BOMBS SURVIVED</span><b>${stats.bombs}</b></li>
         </ul>
         <button id="startBtn">RUN IT AGAIN</button>`
      : `<h1 class="lose">${stats.causeTitle}</h1>
         <h2>${stats.causeText}</h2>
         <ul class="stats">
           <li><span>SURVIVED</span><b>${stats.time}</b></li>
           <li><span>GOT WITHIN</span><b>${stats.remaining} m</b> of the wall</li>
           <li><span>GROUND COVERED</span><b>${stats.distance} m</b></li>
           <li><span>MINES TRIPPED</span><b>${stats.mines}</b></li>
           <li><span>ROUNDS TAKEN</span><b>${stats.hits}</b></li>
         </ul>
         <button id="startBtn">TRY AGAIN</button>`;
    this.startBtn = this.card.querySelector('#startBtn');
  }

  update(dt, s) {
    const e = this.el;
    e.dist.textContent = `${Math.max(0, Math.round(s.distanceToGate))} m`;
    e.progressBar.style.width = `${clamp(s.progress, 0, 1) * 100}%`;
    e.tideLevel.textContent = `${s.tideLevel.toFixed(1)} m`;
    const gap = Math.round(s.tideGap);
    e.tideGap.textContent = gap > 0 ? `${gap} m behind` : `AT YOUR WHEELS`;
    e.tideBar.style.width = `${clamp(1 - gap / 700, 0, 1) * 100}%`;
    e.tideState.textContent = s.tideRising ? (gap < 120 ? 'ON YOU' : 'RISING') : 'SLACK WATER';
    e.tideState.className = `big ${gap < 120 ? 'alarm' : ''}`;

    const hp = clamp(s.health, 0, 100);
    e.healthBar.style.width = `${hp}%`;
    e.healthVal.textContent = `${Math.round(hp)}%`;
    e.statusText.textContent = hp > 70 ? 'NOMINAL' : hp > 40 ? 'DAMAGED' : hp > 15 ? 'CRITICAL' : 'FAILING';
    e.healthBar.className = hp > 40 ? '' : 'crit';
    e.speed.textContent = String(Math.round(s.kmh));
    e.surface.textContent = String(s.surface).toUpperCase();

    // fading warning stack
    let html = '';
    for (const [text, t] of this.warnTimers) {
      const nt = t - dt;
      if (nt <= 0) this.warnTimers.delete(text);
      else {
        this.warnTimers.set(text, nt);
        html += `<div class="warn" style="opacity:${clamp(nt, 0, 1)}">${text}</div>`;
      }
    }
    e.warnings.innerHTML = html;
    const flash = parseFloat(e.hitflash.style.opacity || '0');
    if (flash > 0) e.hitflash.style.opacity = String(Math.max(0, flash - dt * 1.6));

    this.drawMap(s);
  }

  drawMap(s) {
    const ctx = this.ctx;
    const car = s.carPos;
    const spanZ = 900;
    const spanX = spanZ * (MAP_W / MAP_H);
    const toX = (x) => MAP_W / 2 + ((x - car.x) / spanX) * MAP_W;
    const toY = (z) => MAP_H / 2 + ((z - car.z) / spanZ) * MAP_H;

    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.fillStyle = 'rgba(16,22,20,0.72)';
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    // flooded area behind the tide line
    const shoreY = toY(s.shorelineZ);
    if (shoreY < MAP_H) {
      ctx.fillStyle = 'rgba(46,110,140,0.45)';
      ctx.fillRect(0, Math.max(0, shoreY), MAP_W, MAP_H - Math.max(0, shoreY));
      ctx.strokeStyle = '#8fd8ea';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, shoreY);
      ctx.lineTo(MAP_W, shoreY);
      ctx.stroke();
    }

    // roads
    ctx.lineWidth = 2.5;
    for (const path of this.roads.paths) {
      ctx.strokeStyle = path.name === 'main' ? 'rgba(214,198,150,0.85)' : 'rgba(150,140,110,0.55)';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < path.samples.length; i += 3) {
        const p = path.samples[i];
        if (Math.abs(p.z - car.z) > spanZ) { started = false; continue; }
        const X = toX(p.x);
        const Yy = toY(p.z);
        if (!started) { ctx.moveTo(X, Yy); started = true; } else ctx.lineTo(X, Yy);
      }
      ctx.stroke();
    }

    // the wall
    const wallY = toY(COURSE.wallZ);
    if (wallY > -20 && wallY < MAP_H + 20) {
      ctx.strokeStyle = '#d9d2c0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, wallY);
      ctx.lineTo(MAP_W, wallY);
      ctx.stroke();
      ctx.fillStyle = '#7ee08a';
      ctx.fillRect(toX(0) - 5, wallY - 3, 10, 6);
    }

    // sentries: hollow when idle, filled red when they have eyes on you
    for (const sn of s.sentries) {
      if (Math.abs(sn.pos.z - car.z) > spanZ || Math.abs(sn.pos.x - car.x) > spanX) continue;
      const X = toX(sn.pos.x);
      const Yy = toY(sn.pos.z);
      ctx.beginPath();
      ctx.arc(X, Yy, sn.alerted > 0.4 ? 4 : 2.6, 0, 6.28);
      if (sn.alerted > 0.4) {
        ctx.fillStyle = '#ff5b46';
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,140,120,0.6)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // aircraft
    for (const p of s.planes) {
      const X = toX(p.pos.x);
      const Yy = toY(p.pos.z);
      ctx.save();
      ctx.translate(X, Yy);
      ctx.rotate(-p.yaw);
      ctx.fillStyle = '#ffd36b';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // the car
    ctx.save();
    ctx.translate(toX(car.x), toY(car.z));
    ctx.rotate(-s.carYaw + Math.PI);
    ctx.fillStyle = '#9fe8ff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4.5, 6);
    ctx.lineTo(-4.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, MAP_W - 1, MAP_H - 1);
  }
}
