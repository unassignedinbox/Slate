// Rising security bollards set into the carriageway. Down they sit flush with the road; when
// raised they become a stopped obstacle across the whole drive width, so traffic brakes for them.
// Cars already standing on the spot when they come up are clipped and stunned.
const RISE_TIME = 0.75, LOWER_TIME = 1.0, COOLDOWN = 7;

export class BollardGate {
  constructor(id, e, s, o0, o1, posts) {
    this.id = id; this.e = e; this.s = s; this.o0 = o0; this.o1 = o1; this.posts = posts;
    this.state = 'down';     // down | rising | up | lowering
    this.phase = 0;          // 0 = flush, 1 = fully raised
    this.hold = 0; this.cool = 0; this.on = false; this.key = 'gate' + id;
    this.raises = 0;
  }
}

export class Bollards {
  constructor(sim) {
    this.sim = sim;
    this.gates = [];
    this.byEdge = new Map();
    this.nextId = 1;
    this.maxGates = 90;
  }

  place(R, count) {
    const g = this.sim.graph;
    const cands = g.edges.filter(E => !E.bridge && E.len > 150 && E.cat !== 'rural' && E.lanes.length >= 2);
    if (!cands.length) return;
    let guard = 0;
    while (this.gates.length < count && guard++ < count * 40) {
      const E = cands[Math.floor(R() * cands.length)];
      const s = E.len * (0.25 + 0.5 * R());
      if (this.gates.some(o => o.e === E.i && Math.abs(o.s - s) < 120)) continue;
      const [o0, o1] = E.span;
      const posts = Math.max(3, Math.round((o1 - o0) / 1.5));
      const gate = new BollardGate(this.nextId++, E.i, s, o0, o1, posts);
      this.gates.push(gate);
      let list = this.byEdge.get(E.i); if (!list) this.byEdge.set(E.i, list = []);
      list.push(gate);
    }
  }

  // Checkpoints on the race loop itself, so the security grid has something to close on the route.
  placeOnRoute(loop, R, count) {
    const g = this.sim.graph;
    const edges = [];
    let acc = 0;
    for (const m of loop.moves) {
      const E = g.edges[m.e];
      if (acc > 500 && E.len > 120 && !E.bridge && E.lanes.length >= 2) edges.push({ E, m });
      acc += m.len;
    }
    let placed = 0;
    for (let guard = 0; guard < 40 && placed < count && edges.length; guard++) {
      const { E, m } = edges[Math.floor(R() * edges.length)];
      const s = m.d > 0 ? E.len * (0.3 + 0.4 * R()) : E.len * (0.6 - 0.4 * R());
      if (this.gates.some(o => o.e === E.i && Math.abs(o.s - s) < 60)) continue;
      const [o0, o1] = E.span;
      const gate = new BollardGate(this.nextId++, E.i, s, o0, o1, Math.max(3, Math.round((o1 - o0) / 1.5)));
      this.gates.push(gate);
      let list = this.byEdge.get(E.i); if (!list) this.byEdge.set(E.i, list = []);
      list.push(gate);
      placed++;
    }
    // Keep the city from filling up with gates: retire the oldest idle ones.
    while (this.gates.length > this.maxGates) {
      const idx = this.gates.findIndex(gt => gt.state === 'down');
      if (idx < 0) break;
      const [gt] = this.gates.splice(idx, 1);
      const list = this.byEdge.get(gt.e);
      if (list) this.byEdge.set(gt.e, list.filter(x => x !== gt));
      if (gt.on) this.sim.traffic.removeObstacle(gt.key);
    }
  }

  request(gate, hold = 9) {
    if (gate.state !== 'down' && gate.state !== 'lowering') return false;
    if (gate.cool > 0) return false;
    gate.state = 'rising'; gate.hold = hold; gate.raises++;
    this.sim.bollardRaised?.(gate);
    return true;
  }

  update(dt) {
    for (const gt of this.gates) {
      if (gt.cool > 0) gt.cool = Math.max(0, gt.cool - dt);
      switch (gt.state) {
        case 'rising':
          gt.phase = Math.min(1, gt.phase + dt / RISE_TIME);
          if (gt.phase >= 1) { gt.state = 'up'; }
          break;
        case 'up':
          gt.hold -= dt;
          if (gt.hold <= 0) gt.state = 'lowering';
          break;
        case 'lowering':
          gt.phase = Math.max(0, gt.phase - dt / LOWER_TIME);
          if (gt.phase <= 0) { gt.state = 'down'; gt.cool = COOLDOWN; }
          break;
      }
      const on = gt.phase > 0.55;
      if (on !== gt.on) {
        gt.on = on;
        if (on) this.sim.traffic.setObstacle(gt.key, { e: gt.e, s: gt.s, o0: gt.o0, o1: gt.o1 });
        else this.sim.traffic.removeObstacle(gt.key);
      }
    }
  }

  gateAt(e, s) { return (this.byEdge.get(e) || []).find(g => Math.abs(g.s - s) < 4); }
}
