// The HUD is plain DOM, so it stays crisp, accessible and easy to restyle.
// The map is a 2D canvas that shows the route and the portal links at a glance.

import { dist } from '../engine/math.js';

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
};

export function createHud(level) {
  const $ = (id) => document.getElementById(id);
  const el = {
    zone: $('zone'),
    zoneSub: $('zoneSub'),
    timer: $('timer'),
    splits: $('splits'),
    speed: $('speed'),
    next: $('next'),
    result: $('result'),
    resultTime: $('resultTime'),
    resultSplits: $('resultSplits'),
    map: $('map'),
    mapWrap: $('mapWrap'),
    message: $('message'),
  };
  let lastZone = null;
  let messageTimer = 0;
  let shownResult = false;

  function say(text, seconds = 2.5) {
    el.message.textContent = text;
    el.message.classList.add('show');
    messageTimer = seconds;
  }

  function update(world, dt) {
    const part = level.partsById[world.partId];
    if (part && part.id !== lastZone) {
      lastZone = part.id;
      el.zone.textContent = part.name;
      el.zoneSub.textContent = part.subtitle;
      if (world.race.phase !== 'ready') say(`Entering ${part.name}`);
    }

    el.timer.textContent = fmtTime(world.race.elapsed);
    el.speed.textContent = Math.round(world.speedKmh).toString();

    const race = world.race;
    const nextGate = level.gateOrder[race.next];
    if (race.phase === 'finished') {
      el.next.textContent = 'Finished';
    } else if (nextGate) {
      const d = dist(world.car.pos, nextGate.pos);
      const verb = nextGate.role === 'start' ? 'Start line' : nextGate.role === 'finish' ? 'Finish arch' : 'Portal';
      el.next.textContent = `${verb} · ${Math.round(d)} m`;
    }

    if (race.splits.length !== el.splits.childElementCount) {
      el.splits.innerHTML = '';
      for (const sp of race.splits) {
        const li = document.createElement('li');
        li.textContent = `${sp.label}  ${sp.t === 0 ? '' : fmtTime(sp.t)}`;
        el.splits.appendChild(li);
      }
    }

    if (race.phase === 'finished' && !shownResult) {
      shownResult = true;
      el.resultTime.textContent = fmtTime(race.finishedAt - race.startedAt);
      el.resultSplits.innerHTML = '';
      let prev = 0;
      for (const sp of race.splits.slice(1)) {
        const li = document.createElement('li');
        const leg = sp.t - prev;
        prev = sp.t;
        li.textContent = `${sp.label}: ${fmtTime(sp.t)}  (leg ${fmtTime(leg)})`;
        el.resultSplits.appendChild(li);
      }
      el.result.classList.add('show');
    }
    if (race.phase !== 'finished' && shownResult) {
      shownResult = false;
      el.result.classList.remove('show');
    }

    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) el.message.classList.remove('show');
    }
  }

  function setMapVisible(on) {
    el.mapWrap.classList.toggle('show', on);
  }

  function drawMap(world) {
    const canvas = el.map;
    const g = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const b = level.bounds;
    const pad = 60;
    const sx = (W - pad * 2) / (b.maxX - b.minX);
    const sz = (H - pad * 2) / (b.maxZ - b.minZ);
    const s = Math.min(sx, sz);
    const ox = pad + ((W - pad * 2) - (b.maxX - b.minX) * s) / 2;
    const oz = pad + ((H - pad * 2) - (b.maxZ - b.minZ) * s) / 2;
    const X = (x) => ox + (x - b.minX) * s;
    const Z = (z) => oz + (z - b.minZ) * s;

    g.clearRect(0, 0, W, H);
    g.fillStyle = '#20242a';
    g.fillRect(0, 0, W, H);

    // Portal links (dashed) first, so routes sit on top.
    g.setLineDash([6, 6]);
    g.strokeStyle = '#8b929c';
    g.lineWidth = 1.5;
    for (const gate of level.gates) {
      if (gate.role !== 'entry') continue;
      const exit = gate.pair;
      g.beginPath();
      g.moveTo(X(gate.pos[0]), Z(gate.pos[2]));
      g.lineTo(X(exit.pos[0]), Z(exit.pos[2]));
      g.stroke();
    }
    g.setLineDash([]);

    const colours = { A: '#b8bec6', B: '#9aa3ad', C: '#d3d8de' };
    for (const zone of level.parts) {
      g.beginPath();
      zone.route.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[2])) : g.moveTo(X(p[0]), Z(p[2]))));
      g.strokeStyle = colours[zone.id] ?? '#aaa';
      g.lineWidth = 3;
      g.stroke();
      const mid = zone.route.pts[Math.floor(zone.route.pts.length / 2)];
      g.fillStyle = '#e8ecf1';
      g.font = '600 13px system-ui, sans-serif';
      g.fillText(`${zone.id} · ${zone.name}`, X(mid[0]) + 8, Z(mid[2]) - 8);
    }

    for (const gate of level.gates) {
      const x = X(gate.pos[0]);
      const z = Z(gate.pos[2]);
      g.beginPath();
      g.arc(x, z, gate.role === 'exit' ? 4 : 6, 0, Math.PI * 2);
      g.fillStyle = gate.role === 'exit' ? '#dfe5ec' : gate.role === 'entry' ? '#56606c' : '#f4f6f8';
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = '#c8cdd4';
      g.font = '12px system-ui, sans-serif';
      g.fillText(gate.label, x + 8, z + 14);
    }

    // Car.
    const p = world.car.pos;
    const f = world.car.frame.F;
    const x = X(p[0]);
    const z = Z(p[2]);
    const ang = Math.atan2(f[0], f[2]);
    g.save();
    g.translate(x, z);
    g.rotate(-ang + Math.PI);
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6, 7);
    g.lineTo(-6, 7);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.restore();
  }

  return {
    update,
    say,
    setMapVisible,
    drawMap,
    get mapVisible() {
      return el.mapWrap.classList.contains('show');
    },
  };
}

export { fmtTime };
