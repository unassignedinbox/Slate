// Police and air-unit gadgets that act on the road and the air (pure logic).
//  - Tire Net:      magnetic lock-net laid across lanes (replaces the spike strip). One use. Locks tyres.
//  - EMP Burst:     instant electromagnetic pulse. Stalls every civilian/racer vehicle in radius for
//                   a few seconds, and downs drones. Police units are shielded.
//  - Signal Jammer: a field that scrambles navigation and comms for ~12 s. Jammed racers drift and
//                   slow; jammed air units lose their link and fall back.
//  - Photon Wall:   holographic laser barrier across the lanes. Stops and stuns non-police traffic;
//                   overloads after three hits.

const SHIELDED = 'police';

export class Gadgets {
  constructor(sim) {
    this.sim = sim;
    this.items = [];
    this.nextId = 1;
  }

  get traffic() { return this.sim.traffic; }

  addNet(e, s, o0, o1, owner) {
    const item = { id: this.nextId++, kind: 'net', e, s, o0, o1, life: 24, age: 0, used: false, owner: owner?.name || owner?.tag || 'unit' };
    this.items.push(item);
    this.sim.event(`Tire net deployed by ${item.owner}`, 'gadget');
    return item;
  }

  addEMP(x, y, z, owner) {
    const R = 48;
    const item = { id: this.nextId++, kind: 'emp', x, y, z, r: R, life: 1.8, age: 0, owner: owner?.name || 'unit' };
    this.items.push(item);
    let hit = 0;
    for (const v of this.traffic.vehicles) {
      if (!v.alive || v.kind === SHIELDED || v.parked) continue;
      if (Math.hypot(v.x - x, v.z - z) > R) continue;
      v.stalled = 4.2; v.marked = 0; hit++;
    }
    for (const u of this.sim.air.units) {
      if (u.kind === 'heli' || !u.alive) continue;
      if (Math.hypot(u.x - x, u.z - z) > R) continue;
      this.sim.air.destroy(u, 'EMP');
    }
    this.sim.event(`EMP pulse — ${hit} vehicle${hit === 1 ? '' : 's'} stalled`, 'gadget');
    return item;
  }

  addJammer(x, z, owner) {
    const item = { id: this.nextId++, kind: 'jam', x, z, r: 125, life: 12, age: 0, owner: owner?.name || 'unit' };
    this.items.push(item);
    this.sim.event('Signal jammer active — navigation scrambled', 'gadget');
    return item;
  }

  addPhoton(e, s, o0, o1, owner) {
    const item = { id: this.nextId++, kind: 'photon', e, s, o0, o1, life: 40, age: 0, hits: 0, overload: 0, owner: owner?.name || 'unit', hitSet: new Set() };
    item.key = 'photon' + item.id;
    this.items.push(item);
    this.traffic.setObstacle(item.key, { e, s, o0, o1, passPolice: true });
    this.sim.event('Photon wall online — lanes sealed', 'gadget');
    return item;
  }

  update(dt) {
    for (const it of this.items) {
      it.age += dt; it.life -= dt;
      if (it.kind === 'net') this.updateNet(it);
      else if (it.kind === 'jam') this.updateJam(it);
      else if (it.kind === 'photon') this.updatePhoton(it, dt);
    }
    this.items = this.items.filter(it => {
      const keep = it.life > 0 && !(it.kind === 'net' && it.used);
      if (!keep && it.kind === 'photon') this.traffic.removeObstacle(it.key);
      return keep;
    });
  }

  updateNet(it) {
    for (const v of this.traffic.vehicles) {
      if (!v.alive || v.kind === SHIELDED || v.parked || v.e !== it.e) continue;
      if (Math.abs(v.s - it.s) > 1.6 || !this.traffic.laneOverlap(v, it.o0, it.o1)) continue;
      v.v *= 0.22; v.netted = 3.2; v.stunned = Math.max(v.stunned, 0.4);
      v.wanted = Math.min(100, v.wanted + 4);
      it.used = true;
      this.sim.event(`${v.name || 'Vehicle'} hit the tire net — tyres locked`, 'hit');
      return;
    }
  }

  updateJam(it) {
    for (const v of this.traffic.vehicles) {
      if (!v.alive || v.kind === SHIELDED) continue;
      if (Math.hypot(v.x - it.x, v.z - it.z) <= it.r) v.jammed = Math.max(v.jammed, 0.5);
    }
    for (const u of this.sim.air.units) {
      if (Math.hypot(u.x - it.x, u.z - it.z) <= it.r) u.linkLost = Math.max(u.linkLost || 0, 0.5);
    }
  }

  updatePhoton(it, dt) {
    if (it.overload > 0) { it.overload -= dt; if (it.overload <= 0) it.life = 0; return; }
    for (const v of this.traffic.vehicles) {
      if (!v.alive || v.kind === SHIELDED || v.parked || v.e !== it.e) continue;
      if (!this.traffic.laneOverlap(v, it.o0, it.o1)) continue;
      const approach = (it.s - v.s) * v.d;      // > 0 while the car is still short of the wall
      if (approach < -1.0 || approach > 7 || it.hitSet.has(v.id)) continue;
      it.hitSet.add(v.id);
      it.hits++;
      v.v = 0; v.stunned = 3.0; v.wanted = Math.min(100, v.wanted + 8);
      this.sim.event(`${v.name || 'Vehicle'} stopped by the photon wall`, 'hit');
      if (it.hits >= 3) { it.overload = 2.5; this.sim.event('Photon wall overloaded — shutting down', 'gadget'); this.traffic.removeObstacle(it.key); }
    }
    void dt;
  }
}
