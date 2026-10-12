// Street race manager (pure logic). A race is one lap of a closed loop across the city. Racers
// grid up behind the line, drive the loop flat-out (overtaking through lane changes), and get
// "wanted" points whenever they run well over the limit. Police decide what to do with that.
// Racers that are stuck while officers are close get busted; racers that outrun the heat escape.

const RACER_NAMES = ['VIPER', 'NOVA', 'GHOST', 'RAZOR', 'KITE', 'BLAZE', 'ONYX', 'ECHO', 'VOLT', 'SABLE', 'RIPTIDE', 'JINX'];
const PAINTS = [0xd7263d, 0xf4a300, 0x1b998b, 0x2e86ab, 0xf0e1d2, 0x6a4c93, 0x16a34a, 0xff5e00, 0x0b0c10, 0xc9c9d6];
const CIV_PAINTS = [0x9aa3ad, 0x3b4a6b, 0x7a2e2e, 0xc7c2b8, 0x2f3e46, 0x8a6d3b, 0x5c7a4a, 0xb8b1a4, 0x1f2d3d, 0xe8e4d8];

export { PAINTS, CIV_PAINTS };

export class Race {
  constructor(sim, fieldSize = 8) {
    this.sim = sim;
    this.fieldSize = fieldSize;
    this.racers = [];
    this.loop = null;
    this.state = 'idle';     // idle | countdown | running | results
    this.timer = 0;
    this.number = 0;
    this.finishCount = 0;
    this.results = [];
    this.winner = null;
  }

  get length() { return this.loop ? this.loop.length : 0; }

  start() {
    const g = this.sim.graph;
    let loop = null;
    for (let i = 0; i < 6 && !loop; i++) loop = g.buildLoop(this.sim.R);
    if (!loop) { this.sim.event('No race loop could be built', 'warn'); this.state = 'idle'; return; }
    // Retire the previous field into ordinary traffic instead of popping them out of existence.
    for (const r of this.racers) if (r.alive) this.retire(r);
    this.racers = [];
    this.loop = loop;
    this.number++;
    this.sim.bollards.placeOnRoute(loop, this.sim.R, 3);
    this.finishCount = 0; this.winner = null; this.results = [];
    this.cum = [0];
    for (const m of loop.moves) this.cum.push(this.cum[this.cum.length - 1] + m.len);

    const R = this.sim.R;
    const names = [...RACER_NAMES].sort(() => R() - 0.5);
    for (let i = 0; i < this.fieldSize; i++) {
      const gap = 16 + i * 12;                          // metres behind the line
      const k = this.indexAt(this.length - gap);
      const m = loop.moves[k.index];
      // Route: the loop from the grid position, then two more laps as a safety margin.
      const route = [...loop.moves.slice(k.index), ...loop.moves, ...loop.moves];
      const lim = g.edges[m.e].limit;
      const lanes = g.lanesFor(g.edges[m.e], m.d);
      const lane = lanes[i % Math.max(1, lanes.length)] || { o: 0 };
      const s = m.d > 0 ? k.offset : g.edges[m.e].len - k.offset;
      const v0 = lim * (1.45 + R() * 0.25);
      const racer = this.sim.traffic.add({
        kind: 'racer', role: 'race', name: names[i % names.length] + (i >= names.length ? i : ''),
        color: PAINTS[i % PAINTS.length], model: i % 3 === 0 ? 'muscle' : 'sport',
        e: m.e, d: m.d, s, o: lane.o, v: v0 * 0.7, v0, amax: 2.9, aLat: 8.5, T: 0.95, len: 4.5,
      });
      racer.route = route; racer.ri = 0;
      racer.raceDist = -gap; racer.wanted = 0; racer.wasWanted = false; racer.place = 0;
      racer.grid = i;
      this.racers.push(racer);
    }
    this.state = 'countdown';
    this.timer = 6;
    this.sim.event(`Race ${this.number}: ${(loop.length / 1000).toFixed(1)} km loop — grid up`, 'race');
  }

  // Locate a loop position (metres from the line) on the loop's move list.
  indexAt(q) {
    const L = this.length;
    let x = ((q % L) + L) % L;
    let lo = 0, hi = this.loop.moves.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.cum[mid] <= x) lo = mid; else hi = mid - 1; }
    return { index: lo, offset: x - this.cum[lo] };
  }

  retire(r) {
    r.kind = 'civ'; r.role = 'drive'; r.route = null; r.ri = -1; r.raceDist = null;
    r.v0 = this.sim.graph.edges[r.e].limit * 0.95; r.amax = 2.3; r.aLat = 5.5; r.T = 1.2;
    r.model = 'sedan'; r.wanted = 0;
  }

  update(dt) {
    const sim = this.sim;
    if (this.state === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = 'running'; this.timer = 0; sim.event('GREEN — race underway', 'race'); }
      return;
    }
    if (this.state === 'results') {
      this.timer -= dt;
      if (this.timer <= 0) this.start();
      return;
    }
    if (this.state !== 'running') return;

    this.timer += dt;
    for (const r of this.racers) {
      if (!r.alive) continue;
      if (!r.finished && r.raceDist >= this.length) {
        r.finished = true;
        r.route = null; r.ri = -1;                      // finishers drive on freely
        r.place = ++this.finishCount;
        if (!this.winner) this.winner = r;
        sim.event(`${r.name} crosses the line — P${r.place}`, 'race');
      }
    }
    const live = this.racers.filter(r => r.alive && !r.finished);
    if (live.length === 0 || this.timer > 540) this.finish();
  }

  // Ends the current race now (used by the "next race" control); the next grid starts shortly.
  skip() {
    if (this.state === 'running' || this.state === 'countdown') this.finish();
    this.timer = 0;
  }

  finish() {
    this.state = 'results';
    this.timer = 12;
    this.results = this.standings();
    const w = this.winner ? this.winner.name : 'nobody';
    this.sim.event(`Race ${this.number} over — winner ${w}`, 'race');
  }

  // Standings: finishers by place, then the rest by distance covered; busted racers are out.
  standings() {
    const act = this.racers.filter(r => r.alive || r.finished);
    return act.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.place - b.place;
      return (b.raceDist ?? 0) - (a.raceDist ?? 0);
    });
  }

  // Wanted points, escapes and busts. Called every step, regardless of race state.
  updateWanted(dt) {
    const sim = this.sim, g = sim.graph;
    for (const r of this.racers) {
      if (!r.alive) continue;
      const lim = g.edges[r.e].limit;
      const over = r.v - (lim * 1.2 + 1.0);              // m/s above a tolerated speed
      if (over > 0) r.wanted = Math.min(100, r.wanted + over * 0.3 * dt);
      if (r.marked > 0) r.wanted = Math.min(100, r.wanted + 1.0 * dt);
      // Heat only cools off once the racer slows down and nobody is close.
      const cop = sim.police.copNear(r.x, r.z, 260);
      if (over <= 0 && !cop && r.wanted > 0 && r.marked <= 0) r.wanted = Math.max(0, r.wanted - 1.6 * dt);
      if (r.wanted >= 10) r.wasWanted = true;
      if (r.wasWanted && r.wanted <= 0) { r.wasWanted = false; sim.event(`${r.name} lost the cops — escaped`, 'escape'); }

      // Stuck (stalled, netted, stunned, or blocked by a barrier) with officers on top of them.
      const impaired = r.impaired || r.netted > 0 || r.blocked;
      if (impaired && r.v < 2.5) r.stuckT += dt; else r.stuckT = Math.max(0, r.stuckT - dt * 0.5);
      const arresting = sim.police.copNear(r.x, r.z, 22);
      if (r.wanted >= 10 && arresting && (r.stuckT > 2.2 || (r.pitT > 0 && sim.police.copNear(r.x, r.z, 12)))) {
        r.alive = false; r.busted = true;
        sim.event(`${r.name} BUSTED`, 'bust');
        this.checkOverAll();
      }
    }
  }

  checkOverAll() {
    if (this.state === 'running' && this.racers.every(r => !r.alive || r.finished)) this.finish();
  }

  hottest() {
    let best = null;
    for (const r of this.racers) if (r.alive && r.wanted >= 10 && (!best || r.wanted > best.wanted)) best = r;
    return best;
  }
}

// Helper so the race can also create ordinary civilian cars using the same vehicle model.
export function makeCivilian(traffic, R, edgeIndex, d, s, o, v0) {
  return traffic.add({ kind: 'civ', e: edgeIndex, d, s, o, v: v0 * 0.7, v0, color: CIV_PAINTS[Math.floor(R() * CIV_PAINTS.length)], model: R() < 0.2 ? 'van' : 'sedan' });
}
