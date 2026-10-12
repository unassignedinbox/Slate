// HUD: heat meter, race standings, target card, event feed, status line and a city minimap.
// Plain DOM for text, a canvas for the minimap. Refreshes text a few times a second.
import * as THREE from 'three';
import { HEAT_STEPS } from '../sim/index.js';
import { getProfile } from '../../map/road/profiles.js';

const CAT_COLORS = { highway: '#f4c95d', arterial: '#c8ccd4', urban: '#9aa3ad', residential: '#6d7782', rural: '#8d7a4f', industrial: '#8a7a88', oneway: '#9aa3ad', active: '#5a8f5a' };
const FEED_COLORS = { race: '#8ee4ff', police: '#7aa8ff', gadget: '#ffd166', hit: '#ff8fa3', bust: '#ff4d6d', escape: '#7dff9f', heat: '#ff9f1c', warn: '#ff6b6b', info: '#c9d1d9' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class HUD {
  constructor(root, net, sim, view, rig) {
    this.sim = sim; this.view = view; this.rig = rig; this.net = net;
    this.root = root;
    this.el = {
      heat: root.querySelector('#heat'), standings: root.querySelector('#standings'), target: root.querySelector('#target'),
      feed: root.querySelector('#feed'), status: root.querySelector('#status'), help: root.querySelector('#help'),
      race: root.querySelector('#racebar'),
    };
    this.minimap = root.querySelector('#minimap');
    this.mctx = this.minimap.getContext('2d');
    this.minimapOn = true;
    this.showHelp = false;
    this.speedLabel = '1×';
    this.raceHint = '';
    this.timer = 0;
    this.buildBase();
  }

  // Road network drawn once into an offscreen canvas.
  buildBase() {
    const S = this.minimap.width;
    const ext = (this.net.meta.size || 4096) / 2;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(12,16,22,0.82)'; g.fillRect(0, 0, S, S);
    const toPx = (x, z) => [(x + ext) / (2 * ext) * S, (z + ext) / (2 * ext) * S];
    if (this.net.river) {
      g.strokeStyle = '#1d4a5a'; g.lineWidth = Math.max(2, this.net.river.width / (2 * ext) * S);
      g.beginPath();
      this.net.river.pts.forEach(([x, z], i) => { const [px, py] = toPx(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke();
    }
    g.lineCap = 'round';
    const edges = [...this.net.edges.values()];
    for (const cat of Object.keys(CAT_COLORS)) {
      g.strokeStyle = CAT_COLORS[cat]; g.lineWidth = cat === 'highway' ? 2 : 1;
      g.beginPath();
      for (const e of edges) {
        if (getProfile(e).category !== cat) continue;
        const cl = this.net.centerline(e);
        for (let i = 0; i < cl.X.length; i += 12) { const [px, py] = toPx(cl.X[i], cl.Z[i]); i ? g.lineTo(px, py) : g.moveTo(px, py); }
      }
      g.stroke();
    }
    this.base = c;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    this.renderHeat();
    this.renderStandings();
    this.renderTarget();
    this.renderFeed();
    this.renderStatus();
    if (this.minimapOn) this.renderMinimap();
    this.el.help.classList.toggle('hidden', !this.showHelp);
  }

  renderHeat() {
    const lvl = this.sim.heat.level, max = this.sim.heat.max;
    const hot = this.sim.race.hottest();
    let pips = '';
    for (let i = 1; i <= 5; i++) pips += `<span class="pip ${i <= lvl ? 'on' : ''}"></span>`;
    const next = lvl < 5 ? HEAT_STEPS[lvl] : 100;
    this.el.heat.innerHTML = `<div class="label">HEAT</div><div class="pips">${pips}</div>` +
      `<div class="sub">${hot ? `MOST WANTED <b>${esc(hot.name)}</b> ${Math.round(max)}` : 'NO ONE WANTED'}${lvl < 5 && hot ? ` · next ${next}` : ''}</div>` +
      `<div class="sub">units ${this.sim.police.cops.length} · air ${this.sim.air.units.length} · bollards up ${this.sim.bollards.gates.filter(g => g.on).length}</div>`;
  }

  renderStandings() {
    const race = this.sim.race;
    const rows = race.standings().slice(0, 9);
    const head = race.state === 'countdown' ? `GRID · ${Math.ceil(race.timer)}s` : race.state === 'results' ? `RESULTS · next in ${Math.ceil(race.timer)}s` : race.state === 'running' ? 'RACE' : 'WAITING';
    const lenKm = race.length / 1000;
    let html = `<div class="label">${head} · RACE ${race.number} · ${lenKm.toFixed(1)} km</div>`;
    rows.forEach((r, i) => {
      const left = r.finished ? `P${r.place}` : `${Math.max(0, (race.length - (r.raceDist ?? 0)) / 1000).toFixed(2)} km`;
      const sel = this.view.selectedId === r.id ? ' sel' : '';
      html += `<div class="row${sel}"><span class="pos">${i + 1}</span><span class="swatch" style="background:#${r.color.toString(16).padStart(6, '0')}"></span><span class="nm">${esc(r.name)}</span><span class="v">${Math.round(r.v * 3.6)} km/h</span><span class="l">${left}</span>${r.wanted >= 10 ? `<span class="w">★${Math.round(r.wanted)}</span>` : ''}</div>`;
    });
    if (!rows.length) html += '<div class="sub">No racers on the grid.</div>';
    this.el.standings.innerHTML = html;
  }

  renderTarget() {
    const t = this.rig.target;
    if (!t || !t.alive) { this.el.target.innerHTML = `<div class="label">CAMERA</div><div class="sub">${esc(this.rig.label())}</div>`; return; }
    const isAir = t.e === undefined;
    let body;
    if (isAir) {
      body = `<div class="big">${t.kind === 'heli' ? 'POLICE HELICOPTER' : t.kind === 'wall' ? 'WALL DRONE' : t.kind === 'recon' ? 'RECON DRONE' : 'INTERCEPTOR DRONE'}</div><div class="sub">altitude ${t.y.toFixed(0)} m${t.linkLost > 0 ? ' · LINK LOST' : ''}</div>`;
    } else {
      const flags = [];
      if (t.stunned > 0) flags.push('STUNNED'); if (t.netted > 0) flags.push('TYRES LOCKED'); if (t.stalled > 0) flags.push('EMP STALLED');
      if (t.jammed > 0) flags.push('JAMMED'); if (t.spun > 0) flags.push('SPUN OUT'); if (t.blocked) flags.push('BLOCKED'); if (t.marked > 0) flags.push('TAGGED');
      const role = t.kind === 'police' ? (t.parked ? 'ROADBLOCK' : t.role === 'intercept' ? 'INTERCEPT UNIT' : 'PURSUIT UNIT') : t.kind === 'racer' ? (t.finished ? `FINISHED P${t.place}` : 'RACER') : 'TRAFFIC';
      body = `<div class="big">${esc(t.name || 'CIVILIAN')}</div><div class="sub">${role} · ${Math.round(t.v * 3.6)} km/h · limit ${Math.round(this.sim.graph.edges[t.e].limit * 3.6)}</div>` +
        (t.kind === 'racer' || t.wanted > 0 ? `<div class="sub">wanted ${Math.round(t.wanted)}</div><div class="bar"><span style="width:${Math.min(100, t.wanted)}%"></span></div>` : '') +
        (flags.length ? `<div class="flags">${flags.join(' · ')}</div>` : '');
    }
    this.el.target.innerHTML = `<div class="label">${esc(this.rig.label())}</div>${body}`;
  }

  renderFeed() {
    const ev = this.sim.events.slice(-9);
    this.el.feed.innerHTML = ev.map(e => `<div class="ev" style="color:${FEED_COLORS[e.cls] || FEED_COLORS.info}">${esc(e.text)}</div>`).reverse().join('');
  }

  renderStatus() {
    const t = this.sim.time;
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    const hr = this.view.hour;
    const clock = `${String(Math.floor(hr)).padStart(2, '0')}:${String(Math.floor((hr % 1) * 60)).padStart(2, '0')}`;
    this.el.status.innerHTML = `<span>${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} sim</span><span>${this.rig.label()}</span><span>${this.speedLabel || '1×'}</span><span>${clock}</span>`;
    this.el.race.textContent = this.raceHint;
  }

  renderMinimap() {
    const ctx = this.mctx, S = this.minimap.width;
    const ext = (this.net.meta.size || 4096) / 2;
    const P = (x, z) => [(x + ext) / (2 * ext) * S, (z + ext) / (2 * ext) * S];
    ctx.drawImage(this.base, 0, 0);
    // Race loop
    const loop = this.sim.race.loop;
    if (loop && this.sim.race.state !== 'results') {
      ctx.strokeStyle = 'rgba(142,228,255,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath();
      let first = true;
      for (const m of loop.moves) {
        const E = this.sim.graph.edges[m.e];
        const cl = this.net.centerline(this.net.edges.get(E.id));
        const n = cl.X.length;
        for (let i = 0; i < n; i += 14) {
          const i2 = m.d > 0 ? i : n - 1 - i;
          const [px, py] = P(cl.X[i2], cl.Z[i2]);
          if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    }
    for (const v of this.sim.vehicles) {
      if (!v.alive) continue;
      const [px, py] = P(v.x, v.z);
      if (v.kind === 'civ') { ctx.fillStyle = 'rgba(200,205,215,0.55)'; ctx.fillRect(px - 0.7, py - 0.7, 1.4, 1.4); }
      else if (v.kind === 'racer') { ctx.fillStyle = '#' + (v.color >>> 0).toString(16).padStart(6, '0'); ctx.beginPath(); ctx.arc(px, py, v.finished ? 2.2 : 3.2, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
      else if (v.kind === 'police') { ctx.fillStyle = v.parked ? '#ffffff' : (Math.floor(this.sim.time * 4) % 2 ? '#ff4d4d' : '#4d8bff'); ctx.fillRect(px - 2, py - 2, 4, 4); }
    }
    for (const u of this.sim.air.units) {
      if (!u.alive) continue;
      const [px, py] = P(u.x, u.z);
      ctx.fillStyle = u.kind === 'heli' ? '#ffd166' : '#ff9f1c';
      ctx.beginPath(); ctx.arc(px, py, u.kind === 'heli' ? 3.6 : 2.2, 0, 7); ctx.fill();
    }
    for (const g of this.sim.bollards.gates) {
      if (g.state === 'down') continue;
      const p = this.sim.graph.pointAt(g.e, g.s, 0);
      const [px, py] = P(p.x, p.z);
      ctx.fillStyle = '#ffa000'; ctx.fillRect(px - 2, py - 2, 4, 4);
    }
    // Camera
    const cam = this.view.camera;
    const [cx, cy] = P(cam.position.x, cam.position.z);
    const d = new THREE.Vector3(); cam.getWorldDirection(d);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(d.x, -d.z));
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (this.rig.target && this.rig.target.alive) {
      const t = this.rig.target; const [tx, ty] = P(t.x, t.z);
      ctx.strokeStyle = '#8ee4ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(tx, ty, 7, 0, 7); ctx.stroke();
    }
  }
}
