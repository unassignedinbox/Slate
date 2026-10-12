// Police AI (pure logic). Units are dispatched by heat level to whichever racer is hottest.
//  - Chase units follow the target's next junction; intercept units route to a point ahead.
//  - PIT: a unit that gets alongside the target spins it out.
//  - Gadgets: tire nets ahead, signal jammers and EMP pulses at close range, bollard lockdowns
//    on the target's route, and roadblocks (parked cruiser chicane, photon wall or drone wall).
//  - Police are shielded from their own EMP, jammers, photon walls and bollards.
const COPS_BY_HEAT = [0, 1, 2, 3, 4, 5];   // units wanted per heat level 0..5

export class Police {
  constructor(sim) {
    this.sim = sim;
    this.dispatchT = 0;
    this.lockT = 0;
    this.roadblockT = 6;
    this.unitCount = 0;
  }

  get cops() { return this.sim.traffic.vehicles.filter(v => v.alive && v.kind === 'police' && !v.parked); }

  copNear(x, z, r) {
    for (const c of this.cops) if ((c.x - x) ** 2 + (c.z - z) ** 2 <= r * r) return c;
    return null;
  }

  update(dt) {
    const sim = this.sim, level = sim.heat.level;
    const target = sim.race.hottest();
    this.dispatchT -= dt; this.lockT -= dt; this.roadblockT -= dt;
    this.updateChicane(dt);
    sim.air.supervise(target, level, dt);
    if (this.dispatchT <= 0) { this.dispatchT = 1.2; this.dispatch(target, level); }
    for (const c of this.cops) this.think(c, target, level, dt);
    if (level >= 1) for (const r of sim.race.racers) if (r.alive && r.wanted >= 10) this.lockdown(r, level);
    if (target && level >= 3 && this.roadblockT <= 0) { this.roadblockT = 30; this.roadblock(target, level); }
  }

  dispatch(target, level) {
    if (!target) return;
    const want = COPS_BY_HEAT[level];
    const cops = this.cops.filter(c => c.role !== 'park');
    if (cops.length >= want) return;
    this.spawnCop(target, cops.length);
  }

  spawnCop(target, index) {
    const g = this.sim.graph;
    let pts = g.near(target.x, target.z, 460).filter(q => {
      const dd = Math.hypot(q.x - target.x, q.z - target.z);
      return dd > 190 && (q.x - target.x) * target.hx + (q.z - target.z) * target.hz < 0;
    });
    if (!pts.length) pts = g.near(target.x, target.z, 900).filter(q => Math.hypot(q.x - target.x, q.z - target.z) > 260);
    if (!pts.length) return null;
    const q = pts[Math.floor(this.sim.R() * pts.length)];
    const E = g.edges[q.e];
    // Pick the direction that points roughly towards the target.
    let d = 1, best = -Infinity;
    for (const dir of [1, -1]) {
      if (!g.lanesFor(E, dir).length) continue;
      const dot = (E.cl.frameAt(q.s, {}).tx * dir) * target.hx + (E.cl.frameAt(q.s, {}).tz * dir) * target.hz;
      if (dot > best) { best = dot; d = dir; }
    }
    const lanes = g.lanesFor(E, d);
    const lane = lanes[Math.floor(this.sim.R() * lanes.length)];
    const lim = E.limit;
    this.unitCount++;
    const c = this.sim.traffic.add({
      kind: 'police', role: index % 3 === 2 ? 'intercept' : 'chase', name: `UNIT ${this.unitCount}`,
      e: q.e, d, s: q.s, o: lane.o, v: lim * 1.2, v0: lim * 1.65, amax: 3.8, aLat: 7.5, T: 0.85, len: 5.1,
      model: 'cruiser', color: 0xffffff,
    });
    c.target = target; c.repathT = 0; c.noT = 0; c.cd = { emp: 0, jam: 0, net: 0, pit: 0 };
    c.lightPhase = Math.random() * 10;
    if (this.sim.heat.level >= 2) this.sim.event(`${c.name} dispatched behind ${target.name}`, 'police');
    return c;
  }

  think(c, target, level, dt) {
    const g = this.sim.graph;
    const lim = g.edges[c.e].limit;
    for (const k of Object.keys(c.cd)) c.cd[k] = Math.max(0, c.cd[k] - dt);
    c.lightPhase += dt;
    if (!target) {
      c.noT += dt; c.role = c.role === 'park' ? 'park' : 'patrol';
      c.v0 = lim * 0.9; c.route = null; c.ri = -1;
      if (c.noT > 14) { c.alive = false; }
      return;
    }
    c.noT = 0; c.target = target;
    if (c.role === 'patrol') c.role = 'chase';
    c.v0 = lim * (1.65 + (level >= 3 ? 0.2 : 0) + (level >= 4 ? 0.15 : 0));
    c.repathT -= dt;
    if (c.repathT <= 0) { c.repathT = 2.5; this.repath(c, target); }

    const dx = target.x - c.x, dz = target.z - c.z;
    const dist = Math.hypot(dx, dz);
    const behind = dx * target.hx + dz * target.hz < 0;
    // PIT: alongside and close, at speed.
    if (dist < 4.6 && c.cd.pit <= 0 && target.pitT <= 0 && c.v > 5 && !target.parked) {
      target.pitT = 2.5; target.spun = 1.6; target.v *= 0.45; target.wanted = Math.min(100, target.wanted + 6);
      c.cd.pit = 6;
      this.sim.event(`PIT maneuver — ${target.name} spun out`, 'police');
    }
    if (level >= 4 && c.cd.emp <= 0 && dist < 42 && behind) {
      this.sim.gadgets.addEMP(target.x, target.y, target.z, c);
      c.cd.emp = 30;
    }
    if (level >= 3 && c.cd.jam <= 0 && dist < 150) {
      this.sim.gadgets.addJammer(target.x, target.z, c);
      c.cd.jam = 40;
    }
    if (level >= 2 && c.cd.net <= 0 && dist > 22 && dist < 140 && behind) {
      const ah = g.aheadOf(target, 24);
      if (ah) {
        const E = g.edges[ah.e];
        this.sim.gadgets.addNet(ah.e, ah.s, E.span[0], E.span[1], c);
        c.cd.net = 16;
      }
    }
  }

  repath(c, t) {
    const g = this.sim.graph;
    const start = g.nodeOfEnd(c.e, c.d);
    let dest;
    if (c.role === 'intercept') {
      const ah = g.aheadOf(t, 240);
      dest = ah ? g.nodeOfEnd(ah.e, ah.d) : g.nodeOfEnd(t.e, t.d);
    } else dest = g.nodeOfEnd(t.e, t.d);
    const path = g.route(start, dest);
    c.route = path; c.ri = -1;
  }

  // Raise the nearest down bollard gate on the target's path a short way ahead.
  lockdown(target, level) {
    if (this.lockT > 0) return;
    // At heat 1 the security grid only reacts occasionally; from heat 2 police trigger it on purpose.
    if (level < 2 && this.sim.R() < 0.7) return;
    const g = this.sim.graph, B = this.sim.bollards;
    let gate = null;
    g.walkAhead(target, 280, (e, d, base) => {
      const list = B.byEdge.get(e);
      if (!list) return false;
      for (const b of list) {
        const dist = base + (d > 0 ? b.s : g.edges[e].len - b.s);
        if (dist > 40 && dist < 260 && b.state === 'down' && b.cool <= 0) { gate = b; return true; }
      }
      return false;
    });
    if (gate && B.request(gate, 9)) {
      this.lockT = level >= 2 ? 7 : 14;
      this.sim.event('Security lockdown — bollards rising ahead of target', 'police');
    }
  }

  roadblock(target, level) {
    const g = this.sim.graph;
    const ah = g.aheadOf(target, 180 + this.sim.R() * 60);
    if (!ah) return;
    const E = g.edges[ah.e];
    if (E.len < 60) return;
    const kind = level >= 5 ? (this.sim.R() < 0.5 ? 'drone' : 'photon') : level === 4 ? 'photon' : 'chicane';
    if (kind === 'chicane') {
      const lanes = g.lanesFor(E, ah.d);
      const picks = lanes.slice(0, 3);
      const spots = [];
      picks.forEach((lane, i) => {
        const v = this.sim.traffic.add({
          kind: 'police', role: 'park', parked: true, name: 'CHICANE', e: ah.e, d: ah.d, s: ah.s + (i % 2) * 6, o: lane.o, v: 0, v0: 0,
          model: 'cruiser', color: 0xffffff, len: 5.1,
        });
        v.life = 55;
        spots.push(v);
      });
      this.chicanes = (this.chicanes || []).concat(spots);
      this.sim.event('Roadblock: police chicane across the lanes', 'police');
    } else if (kind === 'photon') {
      this.sim.gadgets.addPhoton(ah.e, ah.s, E.span[0], E.span[1], { name: 'PHOTON GRID' });
    } else {
      this.sim.air.spawnWall(ah.e, ah.s, E.span[0], E.span[1], 42);
    }
  }

  updateChicane(dt) {
    for (const v of this.sim.traffic.vehicles) {
      if (v.role === 'park' && v.kind === 'police') {
        v.life = (v.life ?? 55) - dt;
        if (v.life <= 0) v.alive = false;
      }
    }
  }
}
