// Game simulation facade (pure logic). Owns every system and advances them together in fixed steps.
// The renderer only reads state from here; nothing in this folder touches three.js or the DOM.
import { DriveGraph } from './graph.js';
import { Traffic } from './traffic.js';
import { Bollards } from './bollards.js';
import { Gadgets } from './gadgets.js';
import { Air } from './air.js';
import { Police } from './police.js';
import { Race, CIV_PAINTS } from './race.js';
import { rng } from '../../map/road/math.js';

export const HEAT_STEPS = [10, 25, 45, 65, 85];   // wanted points needed for heat levels 1..5
export const FIXED_DT = 1 / 60;

export function heatLevelFor(wanted) {
  let lvl = 0;
  for (const t of HEAT_STEPS) if (wanted >= t) lvl++;
  return lvl;
}

export class GameSim {
  constructor(net, { seed = 1337, civilians = 70, racers = 8, bollardGates = 60 } = {}) {
    this.R = rng(seed * 7919 + 11);
    this.time = 0;
    this.events = [];
    this.graph = new DriveGraph(net);
    this.traffic = new Traffic(this.graph, this.R);
    this.bollards = new Bollards(this);
    this.gadgets = new Gadgets(this);
    this.air = new Air(this);
    this.police = new Police(this);
    this.race = new Race(this, racers);
    this.heat = { level: 0, max: 0 };
    this.civilianTarget = civilians;
    this.bollards.place(this.R, bollardGates);
    for (let i = 0; i < civilians; i++) this.spawnCivilian();
    this.race.start();
  }

  get vehicles() { return this.traffic.vehicles; }

  event(text, cls = 'info') {
    this.events.push({ t: this.time, text, cls });
    if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
  }

  // Ordinary traffic: random car on a random drivable lane, cruising near the limit.
  spawnCivilian() {
    const g = this.graph;
    for (let tries = 0; tries < 20; tries++) {
      const E = g.edges[Math.floor(this.R() * g.edges.length)];
      if (E.cat === 'highway' && this.R() < 0.6) continue;   // keep freeways for racers
      const d = E.fwd && E.bwd ? (this.R() < 0.5 ? 1 : -1) : (E.fwd ? 1 : -1);
      const lanes = g.lanesFor(E, d);
      if (!lanes.length) continue;
      const lane = lanes[Math.floor(this.R() * lanes.length)];
      const v0 = E.limit * (0.85 + this.R() * 0.2);
      const s = 5 + this.R() * Math.max(1, E.len - 10);
      return this.traffic.add({
        kind: 'civ', e: E.i, d, s, o: lane.o, v: v0 * 0.8, v0, amax: 2.0, aLat: 5, T: 1.4,
        color: CIV_PAINTS[Math.floor(this.R() * CIV_PAINTS.length)], model: this.R() < 0.2 ? 'van' : 'sedan',
      });
    }
    return null;
  }

  step(dt) {
    this.time += dt;
    const civ = this.traffic.vehicles.filter(v => v.kind === 'civ').length;
    if (civ < this.civilianTarget && this.R() < 0.5) this.spawnCivilian();
    this.traffic.update(dt);
    this.bollards.update(dt);
    this.gadgets.update(dt);
    this.air.update(dt);
    this.race.update(dt);
    this.race.updateWanted(dt);
    this.police.update(dt);
    this.updateHeat();
  }

  updateHeat() {
    const hot = this.race.hottest();
    const max = hot ? hot.wanted : 0;
    const level = heatLevelFor(max);
    this.heat.max = max;
    if (level !== this.heat.level) {
      this.event(level > this.heat.level ? `HEAT LEVEL ${level}` : `Heat cooling — level ${level}`, level > this.heat.level ? 'heat' : 'info');
      this.heat.level = level;
    }
  }

  // Advance by real seconds in fixed steps (caller multiplies by its time scale).
  advance(seconds) {
    let acc = seconds, n = 0;
    while (acc >= FIXED_DT && n < 40) { this.step(FIXED_DT); acc -= FIXED_DT; n++; }
    return n;
  }
}
